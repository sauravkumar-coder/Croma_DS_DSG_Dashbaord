import pymongo

def main():
    uri = "mongodb://127.0.0.1:27018/zoppertrack?directConnection=true"
    client = pymongo.MongoClient(uri, serverSelectionTimeoutMS=2000)
    db = client.zoppertrack
    
    # Get all fields present in hotspot store documents
    hotspot_stores = list(db["Store"].find({"storeName": {"$regex": "hotspot", "$options": "i"}}))
    fields = set()
    for s in hotspot_stores:
        fields.update(s.keys())
        
    print(f"Fields in Hotspot store documents: {list(fields)}")
    
    # Check if there is any target-like field populated
    for f in fields:
        non_null_count = sum(1 for s in hotspot_stores if s.get(f) is not None)
        print(f"  Field '{f}' is non-null in {non_null_count} / {len(hotspot_stores)} stores")
        
if __name__ == "__main__":
    main()
