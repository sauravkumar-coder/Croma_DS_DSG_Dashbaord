"""
shared/date_utils.py — Shared date and trend utilities for all services.

Previously these constants and functions were duplicated across every service
module (dashboard_service, store_service, target_service, analytics_service)
and main.py.  They are centralised here so a single change propagates everywhere.

Exports:
    MONTH_LABELS   — Ordered list of 3-letter month abbreviations (Jan..Dec)
    month_label()  — Formats (year, month_int) → "Jan-2026" style label
    compute_trend() — Classifies a store as "rising" / "falling" / "stable"
                      based on average month-over-month revenue change
"""

# Ordered 3-letter month abbreviations — index 0 = January.
# Used to convert integer month numbers (1–12) into display labels.
MONTH_LABELS: list[str] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

# Threshold for classifying a store's revenue trend.
# A store whose average MoM change exceeds +3% is "rising";
# below -3% is "falling"; within the band is "stable".
_TREND_THRESHOLD = 0.03


def month_label(year: int, month: int) -> str:
    """
    Convert a (year, month_int) pair to a human-readable label.

    Args:
        year:  Calendar year, e.g. 2026
        month: Month number 1–12

    Returns:
        String in "MMM-YYYY" format, e.g. "Jun-2026"
    """
    return f"{MONTH_LABELS[month - 1]}-{year}"


def compute_trend(monthly_revenue: dict[int, float]) -> str:
    """
    Classify a store's revenue trend across its available months.

    Algorithm:
        1. Sort the month integers in ascending order.
        2. Compute month-over-month percentage change for each consecutive pair,
           skipping pairs where the prior month had zero revenue.
        3. Average the changes.
        4. Apply the ±3% threshold to classify as "rising", "falling", or "stable".

    Args:
        monthly_revenue: Mapping of {month_int: revenue_float}.
                         Keys are integers 1–12; values are revenue in rupees.

    Returns:
        "rising"  — average MoM change > +3%
        "falling" — average MoM change < -3%
        "stable"  — within the ±3% band, or insufficient data
    """
    sorted_months = sorted(monthly_revenue.keys())
    if len(sorted_months) < 2:
        return "stable"

    changes: list[float] = []
    for i in range(1, len(sorted_months)):
        prev = monthly_revenue[sorted_months[i - 1]]
        curr = monthly_revenue[sorted_months[i]]
        if prev > 0:
            changes.append((curr - prev) / prev)

    if not changes:
        return "stable"

    avg_change = sum(changes) / len(changes)
    if avg_change > _TREND_THRESHOLD:
        return "rising"
    if avg_change < -_TREND_THRESHOLD:
        return "falling"
    return "stable"
