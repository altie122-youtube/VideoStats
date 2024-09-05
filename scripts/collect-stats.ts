import { google, youtube_v3 } from "googleapis";
import { promises as fs } from "fs";
import { dirname } from "path";
import { fileURLToPath } from "url";
import pRetry from "p-retry";

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
      version: "v3",
      auth: this.#apiKey,
    });
  }

  async run(channelId: string) {
    console.log("Fetching videos...");
    const videos1 = await this.#getAllVideos(channelId);
    console.log(`${videos1.length} videos fetched in fetch 1!`);
    const videos2 = await this.#getAllVideos(channelId);
    console.log(`${videos2.length} videos fetched in fetch 2!`);
    let videos = videos1.length >= videos2.length ? videos1 : videos2;

    let retrys = 0;
    while (retrys < 3 && videos1.length !== videos2.length) {
      const videos_placeholder = await this.#getAllVideos(channelId);
      console.log(`${videos_placeholder.length} videos fetched in fetch ${retrys + 2}`);
      if (videos_placeholder.length > videos.length) {
        videos = videos_placeholder;
      }
      if (videos.length === videos1.length || videos.length === videos2.length) {
        break;
      }
      retrys++;
    }

    console.log(`${videos.length} videos fetched in ${2 + retrys} attempts!`);

    console.log("Processing data...");
    let videoStats: any = [];
    let videoStatsAttepts = 0;
    while(videos.length !== videoStats.length) {
      videoStats = await Promise.all(
        videos.map((video) => this.#getVideoStats(video.id))
      );
      videoStatsAttepts++
    }

    console.log(`${videoStats.length} video stats fetched in ${videoStatsAttepts} attempts!`);

    const formattedStats = this.#formatData(videoStats);

    console.log("Writing to disk...");
    await this.#writeData(formattedStats);
    console.log("Mission complete!");
  }

  async #getAllVideos(
    channelId: string,
    pageToken = ""
  ): Promise<{ id: string }[]> {
    const request = async () => {
      const response = await this.#youtube.search.list({
        channelId,
        part: "id",
        maxResults: 50,
        pageToken,
        type: "video",
      });
      return response.data;
    };

    const data = await retry(request);
    const videos = data.items?.map((item) => ({ id: item.id.videoId })) || [];
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
        part: "statistics, snippet",
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

// Convert __dirname and __filename for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get the current date and time in UTC format
function getCurrentDateTimeUTC(): string {
  const now = new Date();
  return now
    .toISOString()
    .replace(/[:.]/g, "_")
    .slice(0, 10)
    .replace(/-/g, "/");
}

// Write data to the files paths
async function writeData(data: any) {
  const filePaths = [
    "./published/videoStats.json",
    `./published/archive/${getCurrentDateTimeUTC()}.json`,
  ];

  // Iterate over each file path and write the data asynchronously
  await Promise.all(
    filePaths.map(async (filePath) => {
      // Ensure the directory exists
      await fs.mkdir(dirname(filePath), { recursive: true });

      await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8"); // Pretty-print JSON with 2 spaces indentation
      console.log(`Data written to ${filePath}`);
    })
  );
}

const apiKey = process.env.YOUTUBE_API_KEY!;
const channelId = process.env.CHANNEL_ID!;
const collector = new YouTubeStatsCollector(apiKey);
await collector.run(channelId);
