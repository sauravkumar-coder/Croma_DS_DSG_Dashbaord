import pandas as pd
import os

def main():
    file_path = "c:/Users/Yoganshu Sharma/Desktop/samsung_dashboard/salesdost_samsung/salesdost_samsung/backend/data/targets/2026-06_target.xlsx"
    if not os.path.exists(file_path):
        print(f"File not found: {file_path}")
        return
        
    print(f"Inspecting: {file_path}")
    xl = pd.ExcelFile(file_path)
    print("Sheets:", xl.sheet_names)
    
    df = pd.read_excel(xl, sheet_name=xl.sheet_names[0])
    print(f"Shape: {df.shape}")
    print("Columns:", list(df.columns))
    
    # Look at a sample of store names/keys
    print("First 10 rows:")
    print(df.head(10).to_string())
    
    # Check if there are any mentions of hotspot or hs
    hotspot_rows = df[df.apply(lambda r: r.astype(str).str.contains('hotspot|hs', case=False).any(), axis=1)]
    print(f"\nRows containing 'hotspot' or 'hs': {len(hotspot_rows)}")
    if len(hotspot_rows) > 0:
        print(hotspot_rows.head(10).to_string())

if __name__ == "__main__":
    main()
