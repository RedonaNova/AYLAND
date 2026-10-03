"""The few MongoDB operations the memory code uses, in memory, for offline tests."""

from typing import Any


def _matches(doc: dict[str, Any], query: dict[str, Any]) -> bool:
    for key, want in query.items():
        have = doc.get(key)
        if isinstance(want, dict) and "$ne" in want:
            if have == want["$ne"]:
                return False
        elif have != want:
            return False
    return True


class FakeCursor:
    def __init__(self, docs: list[dict[str, Any]]) -> None:
        self.docs = docs

    def sort(self, key: str, direction: int) -> "FakeCursor":
        self.docs.sort(key=lambda doc: doc[key], reverse=direction < 0)
        return self

    def limit(self, n: int) -> "FakeCursor":
        self.docs = self.docs[:n]
        return self

    async def to_list(self) -> list[dict[str, Any]]:
        return [dict(doc) for doc in self.docs]


class FakeCollection:
    def __init__(self) -> None:
        self.docs: list[dict[str, Any]] = []

    async def find_one(self, query: dict[str, Any]) -> dict[str, Any] | None:
        return next((dict(doc) for doc in self.docs if _matches(doc, query)), None)

    def find(self, query: dict[str, Any]) -> FakeCursor:
        return FakeCursor([doc for doc in self.docs if _matches(doc, query)])

    async def replace_one(self, query: dict[str, Any], doc: dict[str, Any], upsert: bool = False) -> None:
        for i, existing in enumerate(self.docs):
            if _matches(existing, query):
                self.docs[i] = dict(doc)
                return
        if upsert:
            self.docs.append(dict(doc))

    async def insert_one(self, doc: dict[str, Any]) -> None:
        self.docs.append(dict(doc))

    async def insert_many(self, docs: list[dict[str, Any]]) -> None:
        self.docs.extend(dict(doc) for doc in docs)

    async def delete_many(self, query: dict[str, Any]) -> None:
        self.docs = [doc for doc in self.docs if not _matches(doc, query)]


class FakeDb:
    def __init__(self) -> None:
        self.users = FakeCollection()
        self.memories = FakeCollection()
