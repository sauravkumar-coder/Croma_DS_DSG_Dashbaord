import os
import argparse
import pandas as pd
from pymongo import MongoClient, UpdateOne

def main():
    # Default URI based on whether we are on the deployment server (Linux) or local machine (Windows)
    default_uri = os.getenv("MONGO_URI")
    if not default_uri:
        if os.name == "posix":
            # On deployment server host (Linux), connect directly to local MongoDB on port 27017
            default_uri = "mongodb://test_admin:Solvytech1029@127.0.0.1:27017/zoppertrack?authSource=admin&directConnection=true"
        else:
            # On local developer machine (Windows), connect via local SSH tunnel on port 27018
            default_uri = "mongodb://admin:Solvytech%401029@127.0.0.1:27018/zoppertrack?authSource=admin&directConnection=true"

    parser = argparse.ArgumentParser(description="Push July 2026 store targets to MongoDB.")
    parser.add_argument(
        "--mongo",
        default=default_uri,
        help="MongoDB Connection URI"
    )
    args = parser.parse_args()

    # If running inside Docker on the server, default might need to fall back to the production URI
    mongo_uri = args.mongo
    if "127.0.0.1" in mongo_uri and (os.path.exists("/.dockerenv") or os.path.exists("/run/.containerenv")):
        # We are inside a container, resolve to bridge IP or env details
        mongo_uri = "mongodb://saurav:saurav12@172.17.0.1:27017/zoppertrack?authSource=zoppertrack&directConnection=true"

    print(f"Connecting to MongoDB at: {mongo_uri.split('@')[-1]}") # Print host without credentials
    client = MongoClient(mongo_uri)
    db = client.zoppertrack

    # 1. Fetch StoreBrand mappings to map StoreBrand_ID to storeId
    print("Loading StoreBrand configurations from database...")
    sb_cursor = db.StoreBrand.find({"brandId": "brand_002"})
    sb_map = {}
    for doc in sb_cursor:
        sbid = doc.get("storeBrandId")
        if sbid:
            sb_map[str(sbid).strip()] = str(doc.get("storeId"))
    print(f"Loaded {len(sb_map)} brand mappings from database.")

    # 2. July 2026 Target Files
    target_files = {
        "Croma": "c:/Users/Yoganshu Sharma/Desktop/Data Division/croma/croma_store_targets.xlsx",
        "Vijay Sales": "c:/Users/Yoganshu Sharma/Desktop/Data Division/vijay sales/vijay_sales_store_targets.xlsx",
        "Reliance Digital": "c:/Users/Yoganshu Sharma/Desktop/Data Division/reliance digital/reliance_store_targets.xlsx",
        "Hotspot": "c:/Users/Yoganshu Sharma/Desktop/Data Division/hotspot/hotspot_store_targets.xlsx",
    }

    # Backup paths relative to repository if executed on host or inside container directly
    backup_paths = {
        "Croma": "data/targets_july/croma_store_targets.xlsx",
        "Vijay Sales": "data/targets_july/vijay_sales_store_targets.xlsx",
        "Reliance Digital": "data/targets_july/reliance_store_targets.xlsx",
        "Hotspot": "data/targets_july/hotspot_store_targets.xlsx",
    }

    all_target_ops = []
    skipped_count = 0
    total_rev = 0.0

    for name, filepath in target_files.items():
        if not os.path.exists(filepath):
            # Fall back to repository paths if local desktop paths aren't found (e.g. running on server)
            filepath = backup_paths[name]
            if not os.path.exists(filepath):
                print(f"WARNING: Targets file for {name} not found at local or repo path. Skipping.")
                continue

        print(f"Parsing July targets for {name} from {filepath}...")
        df = pd.read_excel(filepath)
        df.columns = [str(c).strip() for c in df.columns]

        for _, row in df.iterrows():
            sbid = str(row.get("StoreBrand_ID", "")).strip()
            month = int(row.get("Month", 7))
            year = int(row.get("Year", 2026))
            rev = row.get("Target_Revenue", 0.0)
            units = row.get("Target_Units", None)

            if pd.isna(rev) or rev < 0:
                continue

            store_id = sb_map.get(sbid)
            if not store_id:
                skipped_count += 1
                continue

            # Ensure correct types
            target_rev_val = float(rev)
            target_units_val = float(units) if pd.notna(units) and not pd.isna(units) else None

            # Upsert into StoreTarget
            filter_q = {
                "storeId": store_id,
                "brandId": "brand_002",
                "month": month,
                "year": year
            }
            all_target_ops.append(UpdateOne(
                filter_q,
                {"$set": {
                    **filter_q,
                    "targetRevenue": target_rev_val,
                    "targetUnits": target_units_val
                }},
                upsert=True
            ))
            total_rev += target_rev_val

    if all_target_ops:
        print(f"Upserting {len(all_target_ops)} StoreTarget records into database...")
        db.StoreTarget.bulk_write(all_target_ops, ordered=False)
        print(f"Successfully loaded targets! Total July target value: {total_rev:,.2f}")
        if skipped_count > 0:
            print(f"NOTE: Skipped {skipped_count} target rows that could not be mapped to DB StoreBrand IDs.")
    else:
        print("No target records found to update.")

if __name__ == "__main__":
    main()
