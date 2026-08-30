import https from "https";

https.get("https://dl.google.com/android/repository/repository2-3.xml", (res) => {
  let data = "";
  res.on("data", (chunk) => (data += chunk));
  res.on("end", () => {
    const matches = data.match(/<remotePackage path="platforms;android-34">[\s\S]*?<\/remotePackage>/g);
    if (matches) {
      console.log("Found android-34 remote package:");
      matches.forEach((m) => {
        const urlMatch = m.match(/<url>(.*?)<\/url>/);
        if (urlMatch) console.log("URL:", urlMatch[1]);
      });
    } else {
      console.log("No exact match. Searching for 34_r:");
      const urlMatches = data.match(/<url>([^<]*?34[^<]*?\.zip)<\/url>/g);
      console.log(urlMatches?.slice(0, 10));
    }
  });
});
