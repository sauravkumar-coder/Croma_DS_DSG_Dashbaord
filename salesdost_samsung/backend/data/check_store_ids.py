import pymongo
import re

def main():
    uri = "mongodb://127.0.0.1:27018/zoppertrack?directConnection=true"
    client = pymongo.MongoClient(uri, serverSelectionTimeoutMS=2000)
    db = client.zoppertrack
    
    stores = list(db["Store"].find())
    print(f"Total stores: {len(stores)}")
    
    id_patterns = {}
    for s in stores:
        s_id = s.get("_id")
        # Extract prefix before digits
        m = re.match(r"^([a-zA-Z_]+)", s_id)
        prefix = m.group(1) if m else "numeric"
        id_patterns[prefix] = id_patterns.get(prefix, 0) + 1
        
    print("\nStore ID prefix patterns:")
    for prefix, count in id_patterns.items():
        print(f"  {prefix}: {count}")
        
    # Sample store IDs for each pattern
    for prefix in id_patterns.keys():
        sample = db["Store"].find_one({"_id": {"$regex": f"^{prefix}"}})
        print(f"  Sample for prefix '{prefix}': {sample.get('_id')} -> {sample.get('storeName')}")

if __name__ == "__main__":
    main()
