import pandas as pd
import glob
import os

def main():
    files = [
        "/srv/salesdost_zopper/Final Sheet-Sales Store (1).xlsx",
        "/srv/salesdost_zopper/stores-export-2026-06-15 (2).xlsx",
        "/srv/salesdost_zopper/store_export_2026-06-08.xlsx",
        "/srv/salesdost_zopper/testing/Final Sheet-Sales Store.xlsx",
        "/srv/salesdost_zopper/scratch/SalesDost Working Store.xlsx"
    ]
    
    for f in files:
        if not os.path.exists(f):
            print(f"File not found: {f}")
            continue
            
        print(f"\n==================================================")
        print(f"Inspecting: {f}")
        try:
            xl = pd.ExcelFile(f)
            print("Sheets:", xl.sheet_names)
            for sheet in xl.sheet_names[:2]:
                df = pd.read_excel(xl, sheet_name=sheet, nrows=5)
                print(f"Sheet '{sheet}' columns:", list(df.columns))
                print(df.head(2))
        except Exception as e:
            print(f"Error reading {f}: {e}")

if __name__ == "__main__":
    main()
