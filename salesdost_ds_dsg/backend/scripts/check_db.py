"""
check_db.py — Quick MongoDB connectivity and data check.

Run from the backend/ folder:
    python scripts/check_db.py

Prints connection status and 3 sample docs from each main collection.
"""

import asyncio
import sys
import os

# Make backend/ root importable (app/, models.py) when run from scripts/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


async def main():
    from app.core.config import settings

    print(f"\n{'='*50}")
    print(f"MONGO_URI     : {'SET (' + settings.MONGO_URI[:30] + '...)' if settings.MONGO_URI else 'NOT SET'}")
    print(f"DATABASE_NAME : {settings.DATABASE_NAME}")
    print(f"USE_MOCK_DATA : {settings.USE_MOCK_DATA}")
    print(f"{'='*50}\n")

    if not settings.MONGO_URI:
        print("FAIL  MONGO_URI is empty - nothing to connect to.")
        return

    from motor.motor_asyncio import AsyncIOMotorClient

    print("Connecting to MongoDB...")
    try:
        client = AsyncIOMotorClient(settings.MONGO_URI, serverSelectionTimeoutMS=5000)
        await client.admin.command("ping")
        print("OK  Ping successful - MongoDB is reachable.\n")
    except Exception as e:
        print(f"FAIL  Connection failed: {e}")
        return

    db = client.get_default_database()

    collections = await db.list_collection_names()
    print(f"Collections in '{db.name}': {collections}\n")

    # Sample 3 documents from each key collection for quick inspection
    for col_name in ["Store", "SalesRecord", "StoreTarget"]:
        try:
            col = db[col_name]
            count = await col.count_documents({})
            docs = await col.find().limit(3).to_list(length=3)
            print(f"--- {col_name} ({count} total docs) ---")
            if docs:
                for d in docs:
                    d.pop("_id", None)
                    print(" ", d)
            else:
                print("  (no documents found)")
            print()
        except Exception as e:
            print(f"  FAIL  Error reading {col_name}: {e}\n")

    client.close()


if __name__ == "__main__":
    asyncio.run(main())
