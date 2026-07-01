import pymongo
import json

def main():
    uri = "mongodb://127.0.0.1:27018/zoppertrack?directConnection=true"
    client = pymongo.MongoClient(uri, serverSelectionTimeoutMS=2000)
    db = client.zoppertrack
    
    targets = list(db["StoreTarget"].find().limit(5))
    print(f"Total targets: {db['StoreTarget'].count_documents({})}")
    for idx, t in enumerate(targets):
        print(f"\n--- Target {idx+1} ---")
        print(json.dumps(t, default=str, indent=2))
        # Find corresponding store Name
        store = db["Store"].find_one({"_id": t.get("storeId")})
        if store:
            print(f"Store: {store.get('storeName')}")

if __name__ == "__main__":
    main()
