"""Explicitly replace assessment data with future demo slots (stdlib only)."""
import argparse
from datetime import datetime, timedelta, timezone
import json
import os
from urllib.request import Request, urlopen


def main():
    parser = argparse.ArgumentParser(description="Replace ALL clinic slots and delete ALL bookings")
    parser.add_argument("--replace-all", action="store_true", required=True,
                        help="Acknowledge that /reset deletes every existing booking")
    args = parser.parse_args()
    base = os.environ["CLINIC_API_URL"].rstrip("/")
    key = os.environ["API_KEY"]
    start = (datetime.now(timezone.utc) + timedelta(days=2)).replace(hour=9, minute=0, second=0, microsecond=0)
    slots = []
    for index in range(12):
        time = start + timedelta(minutes=30 * index)
        slots.append({"id": f"demo-{index + 1}", "provider": "Dr Ade" if index < 6 else "Dr Bello",
                      "start": time.isoformat(), "end": (time + timedelta(minutes=30)).isoformat()})
    request = Request(f"{base}/reset", data=json.dumps({"slots": slots}).encode(),
                      headers={"X-API-Key": key, "Content-Type": "application/json"}, method="POST")
    with urlopen(request, timeout=60) as response:
        print(f"Reset status: {response.status}; installed {len(slots)} synthetic future slots.")


if __name__ == "__main__":
    main()
