import pymongo
from collections import Counter

def main():
    uri = "mongodb://127.0.0.1:27018/zoppertrack?directConnection=true"
    client = pymongo.MongoClient(uri, serverSelectionTimeoutMS=2000)
    db = client.zoppertrack
    
    targets = list(db["StoreTarget"].find())
    store_ids = list(set(t.get("storeId") for t in targets))
    
    stores = list(db["Store"].find({"_id": {"$in": store_ids}}))
    print(f"Total stores with targets: {len(stores)}")
    
    # Count by store category / channel / name patterns
    categories = Counter(s.get("storeCategory") for s in stores)
    channels = Counter(s.get("storeChannel") for s in stores)
    
    print("\nStore categories among target stores:")
    for k, v in categories.items():
        print(f"  {k}: {v}")
        
    print("\nStore channels among target stores:")
    for k, v in channels.items():
        print(f"  {k}: {v}")
        
    # Check if any name doesn't start with Croma or vs
    other_names = [s.get("storeName") for s in stores if not s.get("storeName", "").lower().startswith("croma") and not s.get("storeName", "").lower().startswith("vs") and not "vijay" in s.get("storeName", "").lower()]
    print(f"\nTarget store names that are NOT Croma or Vijay Sales (Count: {len(other_names)}):")
    for name in other_names[:20]:
        print(f"  {name}")

if __name__ == "__main__":
    main()
