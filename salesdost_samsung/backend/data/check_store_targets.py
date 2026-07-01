import pymongo
from collections import Counter

def main():
    uri = "mongodb://127.0.0.1:27018/zoppertrack?directConnection=true"
    client = pymongo.MongoClient(uri, serverSelectionTimeoutMS=2000)
    db = client.zoppertrack
    
    targets = list(db["StoreTarget"].find())
    print(f"Total targets: {len(targets)}")
    
    store_ids = [t.get("storeId") for t in targets]
    
    # Let's see some store documents for these storeIds
    sample_stores = list(db["Store"].find({"_id": {"$in": store_ids[:20]}}))
    print("\nSample store targets matched to store names:")
    for s in sample_stores[:10]:
        print(f"Store ID: {s['_id']}, Name: {s.get('storeName')}")
        
    # Let's count store names containing Croma, Vijay, Reliance, Hotspot
    matched_names = []
    for t in targets:
        s_id = t.get("storeId")
        store = db["Store"].find_one({"_id": s_id})
        if store:
            matched_names.append(store.get("storeName", "").lower())
            
    croma_count = sum(1 for name in matched_names if "croma" in name)
    vs_count = sum(1 for name in matched_names if "vijay" in name or name.startswith("vs "))
    reliance_count = sum(1 for name in matched_names if "reliance" in name)
    hotspot_count = sum(1 for name in matched_names if "hotspot" in name)
    
    print(f"\nTargets by retailer in StoreTarget:")
    print(f"Croma: {croma_count}")
    print(f"Vijay Sales: {vs_count}")
    print(f"Reliance: {reliance_count}")
    print(f"Hotspot: {hotspot_count}")
    print(f"Total matched stores: {len(matched_names)}")

if __name__ == "__main__":
    main()
