import httpx

from ayland.voice.oyu import _retry_after


def test_retry_after_prefers_the_server_header() -> None:
    assert _retry_after(httpx.Response(429, headers={"retry-after": "3"}), attempt=0) == 3.0


def test_retry_after_backs_off_exponentially_without_header() -> None:
    assert [_retry_after(httpx.Response(429), attempt) for attempt in range(3)] == [1.0, 2.0, 4.0]
