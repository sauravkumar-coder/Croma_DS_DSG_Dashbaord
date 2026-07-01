import pandas as pd
import os

def main():
    possible_paths = [
        "Samsung Targets (1).xlsx",
        "../Samsung Targets (1).xlsx",
        "../../Samsung Targets (1).xlsx",
        "../../../Samsung Targets (1).xlsx",
        "backend/data/Samsung Targets (1).xlsx",
        "data/Samsung Targets (1).xlsx",
        "/app/data/Samsung Targets (1).xlsx",
        "c:/Users/Yoganshu Sharma/Desktop/samsung_dashboard/Samsung Targets (1).xlsx",
    ]
    file_path = None
    for path in possible_paths:
        if os.path.exists(path):
            file_path = path
            break
            
    if not file_path:
        print("Samsung Targets (1).xlsx not found!")
        return
        
    print(f"Found Excel at: {file_path}")
    xl = pd.ExcelFile(file_path)
    print(f"Sheet names: {xl.sheet_names}")
    
    for sheet in xl.sheet_names:
        df = pd.read_excel(xl, sheet_name=sheet)
        print(f"\nSheet '{sheet}' shape: {df.shape}")
        print("Columns:", list(df.columns))
        print("First 3 rows:")
        print(df.head(3).to_string())

if __name__ == "__main__":
    main()
