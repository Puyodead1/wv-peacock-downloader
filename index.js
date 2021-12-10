require("better-logging")(console);
const {
  getBestAudioAdaptationSet,
  getBestAudioRepresentation,
  getBestVideoRepresentation,
  fetchManifest,
  dateDiffToString,
  makeDirectories,
  calculateSegmentCount,
  getLicense,
  VIDEO_DEC,
  AUDIO_DEC,
  OUTPUT_DIR,
  processSegments,
  mergeAV,
  cleanup,
  getOutputFilename,
  SUBTITLE_ENC,
  AUDIO_DIR,
  VIDEO_DIR,
  DOWNLOAD_DIR,
} = require("./utils");
const xml2js = require("xml2js");
const { join } = require("path");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("fs");

const keys = {
  "0016eddd721d3cd5d8abdc3e7ab2644d": "decryption key",
};
const mpdURL = "link to master_cmaf.mpd";

// final output path of merged AV
const SERIES_OUTPUT_PATH = join(OUTPUT_DIR, "show name", "S04");

const FILENAME = "name of file.mp4";

function process() {
  return new Promise(async (resolve, reject) => {
    // fetch manifest
    const manifestString = readFileSync("./master_cmaf.mpd");
    try {
      const parser = new xml2js.Parser();
      const manifest = await parser.parseStringPromise(manifestString);

      const adaptationSets = manifest.MPD.Period[0].AdaptationSet;
      const videoAdaptationSet = adaptationSets.find(
        (x) => x.$.contentType === "video"
      );
      const audioAdaptationSets = adaptationSets.filter(
        (x) => x.$.contentType === "audio" && x.$.lang === "en"
      );

      const videoRepresentation =
        getBestVideoRepresentation(videoAdaptationSet);

      // const videoRepresentation = videoAdaptationSet.Representation.find(
      //   (x) => x.$.height === "720"
      // );

      if (!videoRepresentation) {
        reject("failure getting best video representation!");
      }

      const bestAudioAdaptationSet =
        getBestAudioAdaptationSet(audioAdaptationSets);
      if (!bestAudioAdaptationSet) {
        reject("failure getting best audio adaptation set!");
      }
      const audioRepresentation = getBestAudioRepresentation(
        bestAudioAdaptationSet.Representation
      );
      if (!audioRepresentation) {
        reject("failure getting best audio representation!");
      }

      const subtitleRepresentation = adaptationSets.find(
        (x) => x.$.contentType === "text" && x.$.lang === "en"
      );

      console.debug(
        `Best Video: ${videoRepresentation.$.height}x${videoRepresentation.$.width}`,
        `Best Audio: ${audioRepresentation.$.codecs}`
      );

      await makeDirectories();
      //    const baseURL = mpdURL.split("?")[0].split("master_cmaf.mpd")[0];
      const audioInit = audioRepresentation.SegmentTemplate[0].$.initialization;
      const videoInit = videoRepresentation.SegmentTemplate[0].$.initialization;
      // const subtitleInit =
      //   subtitleRepresentation.SegmentTemplate[0].$.initialization;
      const audioMedia = audioRepresentation.SegmentTemplate[0].$.media;
      const videoMedia = videoRepresentation.SegmentTemplate[0].$.media;
      // const subtitleMedia =
      //   subtitleRepresentation.SegmentTemplate[0].$.media;

      const audioPssh = bestAudioAdaptationSet.ContentProtection.find(
        (x) =>
          x.$.schemeIdUri === "urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"
      )["cenc:pssh"][0];

      const videoPssh = videoAdaptationSet.ContentProtection.find(
        (x) =>
          x.$.schemeIdUri === "urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"
      )["cenc:pssh"][0];

      // FIXME: we are currenly assuming all videos have subtitles, which is incorrect
      const audioTimeline =
        audioRepresentation.SegmentTemplate[0].SegmentTimeline[0].S;
      const videoTimeline =
        videoRepresentation.SegmentTemplate[0].SegmentTimeline[0].S;
      // const subtitleTimeline =
      //   subtitleRepresentation.SegmentTemplate[0].SegmentTimeline[0].S;

      const { NOAS, NOVS, NOSS } = await calculateSegmentCount(
        audioTimeline,
        videoTimeline
      );

      console.debug(
        `Calculated '${NOAS}' audio segments and '${NOVS}' video segments`
      );

      const audioUrls = [`${baseURL}${audioInit}`];

      // using NOVS here because its usually always correct
      for (var i = 1; i < NOVS + 1; i++) {
        audioUrls.push(`${baseURL}${audioMedia.replace("$Number$", i)}`);
      }

      const videoUrls = [`${baseURL}${videoInit}`];

      for (var i = 1; i < NOVS + 1; i++) {
        videoUrls.push(`${baseURL}${videoMedia.replace("$Number$", i)}`);
      }

      await processSegments(
        "audio",
        audioUrls,
        NOAS,
        keys["0016eddd721d3cd5d8abdc3e7ab2644d"]
      );
      await processSegments(
        "video",
        videoUrls,
        NOVS,
        keys["0016eddd721d3cd5d8abdc3e7ab2644d"]
      );
      const baseURL = mpdURL.split("?")[0].split("master_cmaf.mpd")[0];
      console.log(baseURL);

      // var audioUrls = `${baseURL}${audioInit}\n  dir=${AUDIO_DIR}\n  out=seg_0.mp4\n`;
      var audioUrls = `${audioInit}\n  dir=${AUDIO_DIR}\n  out=seg_0.mp4\n`;

      // using NOVS here because its usually always correct
      // for (var i = 1; i < NOVS + 1; i++) {
      //   audioUrls += `${baseURL}${audioMedia.replace(
      //     "$Number$",
      //     i
      //   )}\n  dir=${AUDIO_DIR}\n  out=seg_${i}.mp4\n`;
      // }
      for (var i = 1; i < NOVS + 1; i++) {
        audioUrls += `${audioMedia.replace(
          "$Number$",
          i
        )}\n  dir=${AUDIO_DIR}\n  out=seg_${i}.mp4\n`;
      }

      // var videoUrls = `${baseURL}${videoInit}\n  dir=${VIDEO_DIR}\n  out=seg_0.mp4\n`;
      var videoUrls = `${videoInit}\n  dir=${VIDEO_DIR}\n  out=seg_0.mp4\n`;

      // for (var i = 1; i < NOVS + 1; i++) {
      //   videoUrls += `${baseURL}${videoMedia.replace(
      //     "$Number$",
      //     i
      //   )}\n  dir=${VIDEO_DIR}\n  out=seg_${i}.mp4\n`;
      // }
      for (var i = 1; i < NOVS + 1; i++) {
        videoUrls += `${videoMedia.replace(
          "$Number$",
          i
        )}\n  dir=${VIDEO_DIR}\n  out=seg_${i}.mp4\n`;
      }

      const audioListPath = join(AUDIO_DIR, "list.txt");
      const videoListPath = join(VIDEO_DIR, "list.txt");

      writeFileSync(audioListPath, audioUrls);
      writeFileSync(videoListPath, videoUrls);

      // const subtitleUrls = [`${baseURL}${subtitleInit}`];

      // // using NOSS
      // for (var i = 1; i < NOSS + 1; i++) {
      //   subtitleUrls.push(
      //     `${baseURL}${subtitleMedia.replace("$Number$", i)}`
      //   );
      // }

      // process audio and video segments, this includes downloading, merging, and decrypting
      await processSegments(
        "video",
        videoListPath,
        NOVS,
        keys["0016eddd721d3cd5d8abdc3e7ab2644d"]
      );
      await processSegments(
        "audio",
        audioListPath,
        NOVS,
        keys["0016eddd721d3cd5d8abdc3e7ab2644d"]
      );

      console.debug(
        `[Proccessor] All segments have been downloaded, merged and decrypted, merging AV...`
      );

      // create dir if not exists
      if (!existsSync(SERIES_OUTPUT_PATH)) {
        mkdirSync(SERIES_OUTPUT_PATH, { recursive: true });
        console.debug(
          `[Processor] Created output directory at ${SERIES_OUTPUT_PATH}`
        );
      } else {
        console.debug(
          `[Processor] Output directory already exists, skipping creation`
        );
      }

      // merge av
      await mergeAV(
        AUDIO_DEC,
        VIDEO_DEC,
        // SUBTITLE_ENC,
        join(SERIES_OUTPUT_PATH, FILENAME)
      ).catch((e) => console.error(`[MergeAV] Error merging AV: ${e}`));
      console.debug("[Processor] AV Merge complete, cleaning up...");
      await cleanup();
      console.debug("[Processor] Cleanup complete.");
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}

(async () => {
  process();
})();
