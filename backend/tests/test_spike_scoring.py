from spikes.common import cer, normalize


def test_normalize_ignores_case_punctuation_and_spacing() -> None:
    assert normalize("Тийм,  ЗАХИАЛ!") == "тийм захиал"


def test_cer_is_zero_for_same_words() -> None:
    assert cer("Тийм, захиал.", "тийм захиал") == 0.0


def test_cer_counts_character_edits() -> None:
    assert cer("захиал", "захиалъ") == 1 / 6
