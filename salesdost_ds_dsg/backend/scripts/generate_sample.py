#!/usr/bin/env python3
"""
generate_sample.py

Generates realistic sample XLSX files for StoreWise development and testing.

Output files (written to backend/data/):
  sample_sales.xlsx    — 80 stores × 6 months (Apr-2025 to Sep-2025)
  sample_targets.xlsx  — 80 stores × monthly target

Revenue characteristics:
  - Rs.2L–Rs.80L per store per month
  - Four trend profiles: rising (~20%), falling (~15%), stable (~45%), volatile (~20%)
  - Layered seasonal multipliers (summer dip → festival-season pickup)

Requirements:
  pip install pandas openpyxl

Usage:
  cd backend
  python scripts/generate_sample.py
"""

import os
import random

import pandas as pd

# ── Configuration ──────────────────────────────────────────────────────────────

SEED = 42
MONTHS = ["Apr-2025", "May-2025", "Jun-2025", "Jul-2025", "Aug-2025", "Sep-2025"]

# Seasonal multipliers for Indian retail (electronics / appliances)
# Summer dip → Independence Day bump → Navratri build-up
SEASONAL = {
    "Apr-2025": 0.90,
    "May-2025": 0.84,  # peak summer, footfall lowest
    "Jun-2025": 0.88,  # pre-monsoon
    "Jul-2025": 0.93,  # monsoon, slight pickup
    "Aug-2025": 1.02,  # Independence Day + exchange offers
    "Sep-2025": 1.11,  # Navratri / Onam / early festive season
}

CATEGORIES = [
    "Electronics",
    "Large Appliances",
    "Mobile & Tablets",
    "Computers & Peripherals",
    "Small Appliances",
]

# 80 stores: (Store_ID, Store_Name, State)
STORES = [
    # ── Maharashtra (10) ──────────────────────────────────────────────────────
    ("CR001", "Croma Mumbai Lower Parel",    "Maharashtra"),
    ("CR002", "Croma Mumbai Andheri West",   "Maharashtra"),
    ("CR003", "Croma Mumbai Thane",          "Maharashtra"),
    ("CR004", "Croma Mumbai Borivali",       "Maharashtra"),
    ("CR005", "Croma Mumbai Navi Mumbai",    "Maharashtra"),
    ("CR006", "Croma Pune Koregaon Park",    "Maharashtra"),
    ("CR007", "Croma Pune FC Road",          "Maharashtra"),
    ("CR008", "Croma Nagpur Sitabuldi",      "Maharashtra"),
    ("CR009", "Croma Nashik",                "Maharashtra"),
    ("CR010", "Croma Aurangabad",            "Maharashtra"),
    # ── Delhi (8) ─────────────────────────────────────────────────────────────
    ("CR011", "Croma Delhi Connaught Place", "Delhi"),
    ("CR012", "Croma Delhi Lajpat Nagar",   "Delhi"),
    ("CR013", "Croma Delhi Rohini",          "Delhi"),
    ("CR014", "Croma Delhi Dwarka",          "Delhi"),
    ("CR015", "Croma Delhi Karol Bagh",      "Delhi"),
    ("CR016", "Croma Delhi Saket",           "Delhi"),
    ("CR017", "Croma Delhi Janakpuri",       "Delhi"),
    ("CR018", "Croma Delhi Preet Vihar",     "Delhi"),
    # ── Karnataka (8) ─────────────────────────────────────────────────────────
    ("CR019", "Croma Bengaluru Koramangala", "Karnataka"),
    ("CR020", "Croma Bengaluru Indiranagar", "Karnataka"),
    ("CR021", "Croma Bengaluru Whitefield",  "Karnataka"),
    ("CR022", "Croma Bengaluru Jayanagar",   "Karnataka"),
    ("CR023", "Croma Bengaluru Hebbal",      "Karnataka"),
    ("CR024", "Croma Mysuru",                "Karnataka"),
    ("CR025", "Croma Mangaluru",             "Karnataka"),
    ("CR026", "Croma Hubballi",              "Karnataka"),
    # ── Tamil Nadu (8) ────────────────────────────────────────────────────────
    ("CR027", "Croma Chennai Anna Nagar",    "Tamil Nadu"),
    ("CR028", "Croma Chennai T Nagar",       "Tamil Nadu"),
    ("CR029", "Croma Chennai Adyar",         "Tamil Nadu"),
    ("CR030", "Croma Chennai Velachery",     "Tamil Nadu"),
    ("CR031", "Croma Coimbatore",            "Tamil Nadu"),
    ("CR032", "Croma Madurai",               "Tamil Nadu"),
    ("CR033", "Croma Salem",                 "Tamil Nadu"),
    ("CR034", "Croma Tiruchirappalli",       "Tamil Nadu"),
    # ── Gujarat (8) ───────────────────────────────────────────────────────────
    ("CR035", "Croma Ahmedabad CG Road",     "Gujarat"),
    ("CR036", "Croma Ahmedabad Vastrapur",   "Gujarat"),
    ("CR037", "Croma Surat Ring Road",       "Gujarat"),
    ("CR038", "Croma Surat Citylight",       "Gujarat"),
    ("CR039", "Croma Vadodara",              "Gujarat"),
    ("CR040", "Croma Rajkot",                "Gujarat"),
    ("CR041", "Croma Gandhinagar",           "Gujarat"),
    ("CR042", "Croma Anand",                 "Gujarat"),
    # ── Rajasthan (6) ─────────────────────────────────────────────────────────
    ("CR043", "Croma Jaipur MI Road",        "Rajasthan"),
    ("CR044", "Croma Jaipur Vaishali Nagar", "Rajasthan"),
    ("CR045", "Croma Jodhpur",               "Rajasthan"),
    ("CR046", "Croma Udaipur",               "Rajasthan"),
    ("CR047", "Croma Kota",                  "Rajasthan"),
    ("CR048", "Croma Ajmer",                 "Rajasthan"),
    # ── West Bengal (6) ───────────────────────────────────────────────────────
    ("CR049", "Croma Kolkata Park Street",   "West Bengal"),
    ("CR050", "Croma Kolkata Salt Lake",     "West Bengal"),
    ("CR051", "Croma Kolkata New Town",      "West Bengal"),
    ("CR052", "Croma Howrah",                "West Bengal"),
    ("CR053", "Croma Siliguri",              "West Bengal"),
    ("CR054", "Croma Durgapur",              "West Bengal"),
    # ── Telangana (6) ─────────────────────────────────────────────────────────
    ("CR055", "Croma Hyderabad Banjara Hills","Telangana"),
    ("CR056", "Croma Hyderabad Jubilee Hills","Telangana"),
    ("CR057", "Croma Hyderabad Gachibowli",  "Telangana"),
    ("CR058", "Croma Hyderabad Kukatpally",  "Telangana"),
    ("CR059", "Croma Warangal",              "Telangana"),
    ("CR060", "Croma Karimnagar",            "Telangana"),
    # ── Uttar Pradesh (6) ─────────────────────────────────────────────────────
    ("CR061", "Croma Lucknow Hazratganj",    "Uttar Pradesh"),
    ("CR062", "Croma Lucknow Gomti Nagar",   "Uttar Pradesh"),
    ("CR063", "Croma Kanpur",                "Uttar Pradesh"),
    ("CR064", "Croma Agra",                  "Uttar Pradesh"),
    ("CR065", "Croma Varanasi",              "Uttar Pradesh"),
    ("CR066", "Croma Prayagraj",             "Uttar Pradesh"),
    # ── Madhya Pradesh (4) ────────────────────────────────────────────────────
    ("CR067", "Croma Bhopal DB Mall",        "Madhya Pradesh"),
    ("CR068", "Croma Indore Palasia",        "Madhya Pradesh"),
    ("CR069", "Croma Gwalior",               "Madhya Pradesh"),
    ("CR070", "Croma Jabalpur",              "Madhya Pradesh"),
    # ── Punjab (4) ────────────────────────────────────────────────────────────
    ("CR071", "Croma Ludhiana",              "Punjab"),
    ("CR072", "Croma Amritsar",              "Punjab"),
    ("CR073", "Croma Chandigarh",            "Punjab"),
    ("CR074", "Croma Jalandhar",             "Punjab"),
    # ── Kerala (6) ────────────────────────────────────────────────────────────
    ("CR075", "Croma Kochi Lulu Mall",       "Kerala"),
    ("CR076", "Croma Kochi Edapally",        "Kerala"),
    ("CR077", "Croma Thiruvananthapuram",    "Kerala"),
    ("CR078", "Croma Kozhikode",             "Kerala"),
    ("CR079", "Croma Thrissur",              "Kerala"),
    ("CR080", "Croma Kannur",                "Kerala"),
]

# Revenue base ranges by store tier (based on city size and market maturity)
_TIER1_IDS = {
    "CR001", "CR002", "CR011", "CR016",
    "CR019", "CR027", "CR035", "CR055",
}
_TIER2_IDS = {
    "CR003", "CR004", "CR005", "CR006", "CR007",
    "CR012", "CR013", "CR014", "CR015",
    "CR020", "CR021", "CR022", "CR023",
    "CR028", "CR029", "CR030",
    "CR036", "CR037", "CR038",
    "CR049", "CR050", "CR051",
    "CR056", "CR057", "CR058",
    "CR061", "CR062",
    "CR067", "CR068",
    "CR075", "CR076",
}


def _base_revenue(store_id: str, rng: random.Random) -> float:
    if store_id in _TIER1_IDS:
        return rng.uniform(3_000_000, 8_000_000)   # Rs.30L – Rs.80L
    elif store_id in _TIER2_IDS:
        return rng.uniform(1_200_000, 4_000_000)   # Rs.12L – Rs.40L
    else:
        return rng.uniform(200_000, 1_500_000)      # Rs.2L  – Rs.15L


def _assign_trend(store_idx: int, rng: random.Random) -> str:
    roll = rng.random()
    if roll < 0.20:   return "rising"
    if roll < 0.35:   return "falling"
    if roll < 0.80:   return "stable"
    return "volatile"


def _monthly_revenues(
    base: float, trend: str, rng: random.Random
) -> dict[str, float]:
    revenues: dict[str, float] = {}
    current = base

    for idx, month in enumerate(MONTHS):
        seasonal = SEASONAL[month]

        if trend == "rising":
            current *= rng.uniform(1.04, 1.09)
            noise = rng.uniform(0.95, 1.05)
        elif trend == "falling":
            current *= rng.uniform(0.95, 0.98)
            noise = rng.uniform(0.95, 1.05)
        elif trend == "stable":
            current = base
            noise = rng.uniform(0.92, 1.08)
        else:  # volatile
            current = base
            noise = rng.uniform(0.50, 2.00)

        raw = current * seasonal * noise
        clamped = max(200_000, min(8_000_000, raw))
        revenues[month] = round(clamped / 5_000) * 5_000

    return revenues


# ── Generation ────────────────────────────────────────────────────────────────

def generate() -> None:
    rng = random.Random(SEED)

    sales_rows = []
    target_rows = []
    trend_counts: dict[str, int] = {"rising": 0, "falling": 0, "stable": 0, "volatile": 0}

    for idx, (store_id, store_name, state) in enumerate(STORES):
        category = CATEGORIES[idx % len(CATEGORIES)]
        base = _base_revenue(store_id, rng)
        trend = _assign_trend(idx, rng)
        trend_counts[trend] += 1

        monthly = _monthly_revenues(base, trend, rng)

        row: dict = {
            "Store_ID":   store_id,
            "Store_Name": store_name,
            "State":      state,
            "Category":   category,
        }
        row.update(monthly)
        sales_rows.append(row)

        avg_monthly = sum(monthly.values()) / len(monthly)
        target = round(avg_monthly * 1.12 / 10_000) * 10_000
        target_rows.append({"Store_ID": store_id, "Monthly_Target": target})

    # Write output to backend/data/ (one level up from scripts/)
    out_dir = os.path.join(os.path.dirname(__file__), "..", "data")
    os.makedirs(out_dir, exist_ok=True)

    sales_path  = os.path.join(out_dir, "sample_sales.xlsx")
    target_path = os.path.join(out_dir, "sample_targets.xlsx")

    sales_df  = pd.DataFrame(sales_rows)
    target_df = pd.DataFrame(target_rows)

    sales_df.to_excel(sales_path, index=False)
    target_df.to_excel(target_path, index=False)

    total_revenue = sales_df[MONTHS].values.sum()
    avg_store_monthly = total_revenue / (len(STORES) * len(MONTHS))
    min_rev = sales_df[MONTHS].min().min()
    max_rev = sales_df[MONTHS].max().max()
    states_in_data = sales_df["State"].nunique()

    print("=" * 60)
    print("  StoreWise — Sample Data Generator")
    print("=" * 60)
    print(f"  Stores generated : {len(STORES)}")
    print(f"  States covered   : {states_in_data}")
    print(f"  Months           : {MONTHS[0]} to {MONTHS[-1]} ({len(MONTHS)} months)")
    print(f"  Categories       : {len(CATEGORIES)}")
    print()
    print("  Revenue stats:")
    print(f"    Total (all stores, all months) : Rs.{total_revenue/1e7:.2f} Cr")
    print(f"    Avg store/month                : Rs.{avg_store_monthly/1e5:.2f} L")
    print(f"    Min single-month revenue       : Rs.{min_rev/1e5:.2f} L")
    print(f"    Max single-month revenue       : Rs.{max_rev/1e5:.2f} L")
    print()
    print("  Trend distribution:")
    for t, count in trend_counts.items():
        bar = "#" * count
        print(f"    {t:<10} {count:>3} stores  {bar}")
    print()
    print("  Store tier breakdown:")
    print(f"    Tier 1 (metro flagships) : {len(_TIER1_IDS)} stores  Rs.30L - Rs.80L base")
    print(f"    Tier 2 (major cities)    : {len(_TIER2_IDS)} stores  Rs.12L - Rs.40L base")
    remaining = len(STORES) - len(_TIER1_IDS) - len(_TIER2_IDS)
    print(f"    Tier 3 (smaller cities)  : {remaining} stores  Rs.2L - Rs.15L base")
    print()
    print(f"  Saved: {sales_path}")
    print(f"  Saved: {target_path}")
    print("=" * 60)


if __name__ == "__main__":
    generate()
