const mongoose = require('mongoose');
const env = require('./env');

async function connectDB(uri = env.mongoUri) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { autoIndex: true, serverSelectionTimeoutMS: 10000 });
  const dbName = mongoose.connection.db.databaseName;
  if (env.nodeEnv !== 'test') console.log(`[db] connected to MongoDB database "${dbName}"`);
  return mongoose.connection;
}

module.exports = { connectDB };
