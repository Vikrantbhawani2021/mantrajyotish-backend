const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const mongoUri = process.env.MONGO_URI;

mongoose.connect(mongoUri)
  .then(async () => {
    const db = mongoose.connection.db;
    
    const count = await db.collection('astrologers').countDocuments({});
    console.log('Total astrologers in DB:', count);
    
    const astros = await db.collection('astrologers').find({}).toArray();
    console.log('Astrologer details:', astros.map(a => ({
      id: a._id,
      name: a.name,
      email: a.email,
      status: a.status,
      isVerified: a.isVerified,
      createdAt: a.createdAt
    })));
    
    // Find interview requests
    const interviews = await db.collection('astrointerviews').find({}).toArray();
    console.log('Interview requests:', interviews.map(i => ({
      id: i._id,
      astrologer: i.astrologer,
      status: i.status,
      result: i.result
    })));

    process.exit(0);
  })
  .catch(err => {
    console.error('Connection error:', err);
    process.exit(1);
  });
