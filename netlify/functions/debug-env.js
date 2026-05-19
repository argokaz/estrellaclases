exports.handler = async () => ({
  statusCode: 200,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    NETLIFY_BLOBS_CONTEXT: process.env.NETLIFY_BLOBS_CONTEXT ? "SET" : "NOT SET",
    NETLIFY_SITE_ID: process.env.NETLIFY_SITE_ID || "NOT SET",
    SITE_ID: process.env.SITE_ID || "NOT SET",
    NETLIFY: process.env.NETLIFY || "NOT SET",
    CONTEXT: process.env.CONTEXT || "NOT SET",
  }),
});
