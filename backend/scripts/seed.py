"""Load the demo data into MongoDB; also the demo reset (HANDBOOK M1-B2).

uv run python -m scripts.seed      (or `npm run seed` from the repo root)
"""

import asyncio

from ayland.db.client import get_db
from ayland.demo import seed


async def main() -> None:
    db = get_db()
    trip_id = await seed.reset(db)
    print(f"seeded {trip_id} into '{db.name}'")


if __name__ == "__main__":
    asyncio.run(main())
