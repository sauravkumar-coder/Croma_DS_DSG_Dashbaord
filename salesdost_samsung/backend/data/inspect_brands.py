import pymongo

def main():
    uri = "mongodb://127.0.0.1:27018/zoppertrack?directConnection=true"
    client = pymongo.MongoClient(uri, serverSelectionTimeoutMS=2000)
    db = client.zoppertrack
    
    brands = list(db["Brand"].find())
    print("Brands in database:")
    for b in brands:
        print(f"  ID: {b['_id']}, Name: {b.get('name')}")
        
if __name__ == "__main__":
    main()
