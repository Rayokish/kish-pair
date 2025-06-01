const express = require("express");

if (process.env.VERCEL) {
  // Export function for Vercel
  module.exports = (req, res) => {
    res.status(200).send("Hello from Vercel-Compatible API!");
  };
} else {
  // Start Express server for Render or local usage
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(express.static("public"));

  app.get("/", (req, res) => {
    res.sendFile(__dirname + "/public/index.html");
  });

  app.listen(PORT, () => {
    console.log("Server running on port", PORT);
  });
}