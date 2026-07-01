import pymongo
from collections import Counter

def main():
    uri = "mongodb://127.0.0.1:27018/zoppertrack?directConnection=true"
    client = pymongo.MongoClient(uri, serverSelectionTimeoutMS=2000)
    db = client.zoppertrack
    
    targets = list(db["StoreTarget"].find())
    brand_counts = Counter(t.get("brandId") for t in targets)
    print("StoreTarget counts by brandId:")
    for b_id, count in brand_counts.items():
        print(f"  {b_id}: {count}")
        
    # Let's print a sample target for each brandId
    for b_id in brand_counts.keys():
        t = db["StoreTarget"].find_one({"brandId": b_id})
        print(f"\nSample for brand {b_id}:")
        print(t)
        store = db["Store"].find_one({"_id": t.get("storeId")})
        if store:
            print(f"  Store Name: {store.get('storeName')}")
            
if __name__ == "__main__":
    main()
