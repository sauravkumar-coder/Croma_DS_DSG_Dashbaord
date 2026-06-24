import logging
import os
from motor.motor_asyncio import AsyncIOMotorClient

logger = logging.getLogger(__name__)

MONGO_DETAILS = os.getenv("MONGO_URI", "mongodb://saurav:saurav12@172.17.0.1:27017/zoppertrack?authSource=zoppertrack&directConnection=true")

client: AsyncIOMotorClient | None = None
database = None

async def connect_to_mongo():
    global client, database
    logger.info("Connecting to MongoDB...")
    try:
        client = AsyncIOMotorClient(MONGO_DETAILS, serverSelectionTimeoutMS=5000)
        # Verify connection
        await client.admin.command('ping')
        database = client.zoppertrack
        logger.info("Successfully connected to MongoDB zoppertrack database.")
    except Exception as e:
        logger.error(f"Error connecting to MongoDB: {e}")
        # Depending on how critical this is, we might raise or just log
        # For now, just log to let the app start even if DB is down initially
        client = None
        database = None

async def close_mongo_connection():
    global client
    if client:
        logger.info("Closing MongoDB connection...")
        client.close()
        logger.info("MongoDB connection closed.")

def get_db():
    return database
