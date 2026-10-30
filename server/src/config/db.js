const mongoose = require("mongoose");

async function connectDB(options = {}) {
  const { quiet = false, ...connectionOptions } = options;
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set in .env");
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000, socketTimeoutMS: 20000, maxPoolSize: 10, ...connectionOptions });
  if (!quiet) console.log("MongoDB connected:", mongoose.connection.name);
}

module.exports = connectDB;
