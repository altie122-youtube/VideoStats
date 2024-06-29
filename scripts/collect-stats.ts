import { google, youtube_v3 } from 'googleapis';
import { writeFile } from 'node:fs/promises';
import pRetry from 'p-retry';

const retry: typeof pRetry = (fn, opts) =>
  pRetry(fn, {
    onFailedAttempt: (e) =>
      console.log(
        `Attempt ${e.attemptNumber} failed. There are ${e.retriesLeft} retries left.\n`,
        e.message
      ),
    ...opts,
  });

class YouTubeStatsCollector {
  #apiKey: string;
  #youtube: youtube_v3.Youtube;

  constructor(apiKey: string) {
    this.#apiKey = apiKey;
    this.#youtube = google.youtube({
      version: 'v3',
      auth: this.#apiKey,
    });
  }

  async run(channelId: string) {
    const videos = await this.#getAllVideos(channelId);
    console.log('Processing data...');

    const videoStats = await Promise.all(videos.map(video => this.#getVideoStats(video.id)));

    const formattedStats = this.#formatData(videoStats);

    console.log('Writing to disk...');
    await this.#writeData(formattedStats);
    console.log('Mission complete!');
  }

  async #getAllVideos(channelId: string, pageToken = ''): Promise<{ id: string }[]> {
    const request = async () => {
      const response = await this.#youtube.search.list({
        channelId,
        part: 'id',
        maxResults: 50,
        pageToken,
        type: 'video',
      });
      return response.data;
    };

    const data = await retry(request);
    const videos = data.items?.map(item => ({ id: item.id.videoId })) || [];
    const nextPageToken = data.nextPageToken;

    if (nextPageToken) {
      const nextVideos = await this.#getAllVideos(channelId, nextPageToken);
      videos.push(...nextVideos);
    }

    return videos;
  }

  async #getVideoStats(videoId: string) {
    const request = async () => {
      const response = await this.#youtube.videos.list({
        id: videoId,
        part: 'statistics, snippet',
      });
      return response.data.items?.[0];
    };

    return await retry(request);
  }

  #formatData(data: any) {
    const formattedData: Record<string, any> = {};
    data.forEach((video: any) => {
      if (video) {
        formattedData[video.id] = {
          title: video.snippet.title,
          description: video.snippet.description,
          views: video.statistics.viewCount,
          likes: video.statistics.likeCount,
          published: video.snippet.publishedAt,
          thumbnails: video.snippet.thumbnails,
        };
      }
    });
    return formattedData;
  }

  async #writeData(data: any) {
    return await writeData(data);
  }
}

// Get the current date and time in UTC format
function getCurrentDateTimeUTC(): string {
  const now = new Date();
  return now.toISOString().replace(/[:.]/g, '_').slice(0, 10);
}


async function writeData(data: any) {
  const filePaths = [
    './published/videoStats.json',
    `./published/archive/${getCurrentDateTimeUTC()}_videoStats.json`,
  ];

  // Iterate over each file path and write the data asynchronously
  await Promise.all(filePaths.map(async (filePath) => {
    await writeFile(filePath, JSON.stringify(data), 'utf8');
    console.log(`Data written to ${filePath}`);
  }));
}

const apiKey = process.env.YOUTUBE_API_KEY!;
const channelId = process.env.CHANNEL_ID!;
const collector = new YouTubeStatsCollector(apiKey);
await collector.run(channelId);
