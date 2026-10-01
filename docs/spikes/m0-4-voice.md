# M0-4 voice spike: tsuurAI TTS + Anir STT

_Generated 2026-10-01 15:47 by `backend/spikes/voice_spike.py`._

## tsuurAI TTS

| Voice | Line | Synthesis ms | Audio s | File |
|---|---|---|---|---|
| mbspeech | 1 | 874 | 5.2 | `tts-mbspeech-1.wav` |
| mbspeech | 2 | 738 | 2.3 | `tts-mbspeech-2.wav` |
| mbspeech | 3 | 579 | 0.8 | `tts-mbspeech-3.wav` |
| mbspeech | 4 | 683 | 5.1 | `tts-mbspeech-4.wav` |
| baseline | 1 | 573 | 5.1 | `tts-baseline-1.wav` |
| baseline | 2 | 600 | 2.4 | `tts-baseline-2.wav` |
| baseline | 3 | 644 | 1.2 | `tts-baseline-3.wav` |
| baseline | 4 | 607 | 5.4 | `tts-baseline-4.wav` |
| mn1h | 1 | 3790 | 5.2 | `tts-mn1h-1.wav` |
| mn1h | 2 | 1693 | 2.1 | `tts-mn1h-2.wav` |
| mn1h | 3 | 1838 | 1.4 | `tts-mn1h-3.wav` |
| mn1h | 4 | 692 | 5.1 | `tts-mn1h-4.wav` |

## Anir STT on tsuurAI audio (round trip)

| Voice | Line | STT ms | CER | Heard |
|---|---|---|---|---|
| mbspeech | 1 | 880 | 6% | бид дөрвүүлээ хараад байна бороо орчихлоо өнөөдөр нэг зүүн доллар дотор юу хийж болох вэ |
| mbspeech | 2 | 695 | 6% | хоёр дахь хувилбар захиалаад өгөөч |
| mbspeech | 3 | 737 | 36% | тэд захиалж |
| mbspeech | 4 | 753 | 19% | морь боож эхэллээ өөдийн хоёр гадаа хөтөлбөрт нөлөөлөх тул ч хүү |
| baseline | 1 | 717 | 10% | бид дөрвүүлээ ханаад маань бороо орчихлоо өнөөдөр нэг зуун тослог дотор юу хийж болох вэ |
| baseline | 2 | 641 | 0% | хоёр дахь хувилбарыг захиалаад өгөөч |
| baseline | 3 | 700 | 0% | тийм захиал |
| baseline | 4 | 680 | 3% | бороо ойж эхэллээ өнөөдрийн хоёр гадаа хөтөлбөр нөлөөлөх тул өөрчлөх үү |
| mn1h | 1 | 751 | 20% | мэт дөрвүүлээ ханаг ван бүр орчихлоо өнөөдөр зуун доллар доторыг юу хийж болох вэ |
| mn1h | 2 | 1744 | 14% | хоёр дахь хувиартаа захиалаад өгөөч |
| mn1h | 3 | 3662 | 45% | хийн заг ай |
| mn1h | 4 | 1747 | 22% | бороо орж эхэллээөнөөдрийн хоёр та дахин дээвэрт нөлөөлөх тул уучлах үү |

## Anir STT on real recordings

_None yet. Record the lines as `backend/spikes/recordings/1.wav` … `3.wav` and re-run._

## Not covered by Novelsoft

Anir and tsuurAI are Mongolian only. The interpreter's Vietnamese side (Act 4) needs another engine: the browser Web Speech API (vi-VN) is the quickest candidate to try next.
