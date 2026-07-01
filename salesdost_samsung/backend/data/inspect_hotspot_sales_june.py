import pymongo

def main():
    uri = "mongodb://127.0.0.1:27018/zoppertrack?directConnection=true"
    client = pymongo.MongoClient(uri, serverSelectionTimeoutMS=2000)
    db = client.zoppertrack
    
    hotspot_stores = list(db["Store"].find({"storeName": {"$regex": "hotspot", "$options": "i"}}))
    hotspot_store_ids = [s["_id"] for s in hotspot_stores]
    
    # Let's inspect June 2026 sales records
    sales = list(db["SalesRecord"].find({
        "storeId": {"$in": hotspot_store_ids},
        "year": 2026
    }))
    
    print(f"Total 2026 SalesRecords for Hotspot: {len(sales)}")
    
    total_june_revenue = 0
    total_june_sales_count = 0
    non_zero_records = 0
    
    for r in sales:
        daily = r.get("dailySales", {})
        june_days = daily.get("6", [])
        june_rev = sum(d.get("revenue", 0) for d in june_days)
        june_count = sum(d.get("countOfSales", 0) for d in june_days)
        
        # Also check monthlySales if any
        monthly = r.get("monthlySales", [])
        june_monthly_rev = 0
        for m_val in monthly:
            if m_val.get("month") == 6:
                june_monthly_rev = m_val.get("revenue", 0)
                
        if june_rev > 0 or june_monthly_rev > 0:
            non_zero_records += 1
            total_june_revenue += max(june_rev, june_monthly_rev)
            total_june_sales_count += june_count
            print(f"Store {r['storeId']} has June sales: daily={june_rev}, monthly={june_monthly_rev}")
            
    print(f"\nSummary for June 2026 Hotspot Sales in DB:")
    print(f"Non-zero sales records: {non_zero_records}")
    print(f"Total revenue: {total_june_revenue}")
    print(f"Total sales count: {total_june_sales_count}")

if __name__ == "__main__":
    main()
