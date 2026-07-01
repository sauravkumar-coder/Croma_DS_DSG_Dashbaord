import pymongo
import json

def main():
    uri = "mongodb://127.0.0.1:27018/zoppertrack?directConnection=true"
    client = pymongo.MongoClient(uri, serverSelectionTimeoutMS=2000)
    db = client.zoppertrack
    
    # 1. Inspect Hotspot stores
    hotspot_stores = list(db["Store"].find({"storeName": {"$regex": "hotspot", "$options": "i"}}))
    print(f"Total Hotspot stores: {len(hotspot_stores)}")
    if hotspot_stores:
        print("\nSample Hotspot Store:")
        print(json.dumps(hotspot_stores[0], default=str, indent=2))
        
    # 2. Inspect SalesRecords for Hotspot stores
    hotspot_store_ids = [s["_id"] for s in hotspot_stores]
    sales = list(db["SalesRecord"].find({"storeId": {"$in": hotspot_store_ids}}))
    print(f"\nTotal SalesRecords for Hotspot: {len(sales)}")
    if sales:
        print("\nSample SalesRecord:")
        print(json.dumps(sales[0], default=str, indent=2))
        
    # 3. Check targets in StoreTarget for ANY of the hotspot store IDs
    # Let's do a case-insensitive check or check if any storeName matches
    targets = list(db["StoreTarget"].find({"storeId": {"$in": hotspot_store_ids}}))
    print(f"\nTotal StoreTarget docs matching Hotspot store IDs: {len(targets)}")
    
    # 4. Check if targets exist for Hotspot stores but using storeName instead of storeId
    # Maybe storeId in StoreTarget is different from storeId in Store?
    all_targets = list(db["StoreTarget"].find())
    all_target_store_ids = set(t.get("storeId") for t in all_targets)
    print(f"\nUnique storeIds in StoreTarget: {len(all_target_store_ids)}")
    
    # Find stores matching these target store IDs
    target_stores = list(db["Store"].find({"_id": {"$in": list(all_target_store_ids)}}))
    print(f"Matched target stores count: {len(target_stores)}")
    
    # Check if any target store has "hotspot" in its name
    hotspot_target_stores = [s for s in target_stores if "hotspot" in s.get("storeName", "").lower()]
    print(f"Target stores containing 'hotspot' in name: {len(hotspot_target_stores)}")
    for s in hotspot_target_stores[:5]:
        print(f"Store ID: {s['_id']}, Name: {s.get('storeName')}")

if __name__ == "__main__":
    main()
