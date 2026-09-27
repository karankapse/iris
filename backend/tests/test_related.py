"""Speech heard while replies load: part of the same turn, or the TV?"""

from app.services.related import keyword_related


def test_keyword_overlap_decides_offline():
    assert keyword_related("Are you hungry? I made soup.", "The soup is still hot.")
    assert not keyword_related("Are you hungry?", "Tonight's weather: rain in the north.")


def test_related_endpoint_uses_mock_without_a_key(client):
    r = client.post("/api/related", json={"previous": "Want some tea?", "new": "Green tea, maybe"})
    assert r.status_code == 200
    assert r.json() == {"related": True}
    r = client.post("/api/related", json={"previous": "Want some tea?", "new": "Goal for Arsenal!"})
    assert r.json() == {"related": False}
