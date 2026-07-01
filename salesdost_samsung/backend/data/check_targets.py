import pymongo
import json

def main():
    uri = "mongodb://127.0.0.1:27018/zoppertrack?directConnection=true"
    client = pymongo.MongoClient(uri, serverSelectionTimeoutMS=2000)
    db = client.zoppertrack
    
    # Get all hotspot stores
    hotspot_stores = list(db["Store"].find({"storeName": {"$regex": "hotspot", "$options": "i"}}))
    hotspot_store_ids = [doc["_id"] for doc in hotspot_stores]
    
    print(f"Hotspot stores in Store collection: {len(hotspot_stores)}")
    
    # Check targets in StoreTarget
    targets = list(db["StoreTarget"].find({"storeId": {"$in": hotspot_store_ids}}))
    print(f"Targets matching hotspot stores in StoreTarget collection: {len(targets)}")
    if targets:
        print("Sample target:")
        print(json.dumps(targets[0], default=str, indent=2))
        
        # Unique target months
        months = set(t.get("month") for t in targets)
        print(f"Unique months in hotspot targets: {list(months)}")
    else:
        print("No targets found in StoreTarget collection for hotspot stores.")

if __name__ == "__main__":
    main()
