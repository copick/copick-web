"""Editing object types: the web counterpart of the desktop Edit Object Types dialog."""

from __future__ import annotations

import json
import os

import copick
import pytest

URL = "/api/object-types"


def _types(client):
    body = client.get(URL).json()
    return body, {o["name"]: o for o in body["objects"]}


def _payload(version, **fields):
    base = {"name": "proteasome", "is_particle": True, "label": 9, "color": [10, 20, 30, 255], "radius": 75.0}
    base.update(fields)
    return {"version": version, **base}


def test_list_object_types(client, demo_config):
    body, by_name = _types(client)
    assert body["editable"] and body["config_file"] == demo_config.name
    assert body["suggested_label"] == max(o["label"] for o in body["objects"]) + 1
    assert "ribosome" in by_name and set(by_name["ribosome"]) >= {"color", "radius", "emdb_id", "filament"}


def test_create_saves_the_config_and_refreshes_objects(client, service, demo_config):
    body, _ = _types(client)
    created = client.post(URL, json=_payload(body["version"]))
    assert created.status_code == 201, created.text
    assert created.json()["version"] != body["version"]
    # the running server and the file both see it, and a fresh copick root reads it back
    assert any(o["name"] == "proteasome" for o in client.get("/api/objects").json())
    on_disk = json.loads(demo_config.read_text())
    assert any(o["name"] == "proteasome" and o["label"] == 9 for o in on_disk["pickable_objects"])
    assert copick.from_file(str(demo_config)).get_object("proteasome").color == (10, 20, 30, 255)
    assert service.root.get_object("proteasome") is not None  # copick's object cache was reset


def test_update_keeps_fields_the_form_does_not_show(client, service, demo_config):
    objects = service.root.config.pickable_objects
    i = next(i for i, o in enumerate(objects) if o.name == "ribosome")
    objects[i] = objects[i].model_copy(update={"metadata": {"lab": {"note": "keep me"}}})
    body, by_name = _types(client)
    r = by_name["ribosome"]
    r["color"] = [1, 2, 3, 255]
    response = client.put(f"{URL}/ribosome", json={"version": body["version"], **r})
    assert response.status_code == 200, response.text
    saved = next(o for o in json.loads(demo_config.read_text())["pickable_objects"] if o["name"] == "ribosome")
    assert saved["color"] == [1, 2, 3, 255] and saved["metadata"]["lab"] == {"note": "keep me"}


def test_filament_declaration_round_trip(client, demo_config):
    body, by_name = _types(client)
    r = by_name["ribosome"]
    r["filament"] = {"polar": True, "helical_rise_a": 9.4, "helical_twist_deg": None}
    response = client.put(f"{URL}/ribosome", json={"version": body["version"], **r})
    assert response.status_code == 200, response.text
    after = {o["name"]: o for o in response.json()["objects"]}["ribosome"]
    assert after["filament"] == {"polar": True, "helical_rise_a": 9.4, "helical_twist_deg": None}
    saved = next(o for o in json.loads(demo_config.read_text())["pickable_objects"] if o["name"] == "ribosome")
    assert saved["metadata"]["copick"]["filament"] == {"polar": True, "helical_rise_a": 9.4}
    assert {o["name"]: o for o in client.get("/api/objects").json()}["ribosome"]["is_filament"]

    after["filament"] = None
    response = client.put(f"{URL}/ribosome", json={"version": response.json()["version"], **after})
    saved = next(o for o in json.loads(demo_config.read_text())["pickable_objects"] if o["name"] == "ribosome")
    assert "copick" not in (saved.get("metadata") or {})


def test_rename_and_delete(client, demo_config):
    body, by_name = _types(client)
    r = dict(by_name["ribosome"], name="ribosome-80s")
    renamed = client.put(f"{URL}/ribosome", json={"version": body["version"], **r})
    assert renamed.status_code == 200
    names = {o["name"] for o in renamed.json()["objects"]}
    assert "ribosome-80s" in names and "ribosome" not in names

    deleted = client.delete(f"{URL}/ribosome-80s", params={"version": renamed.json()["version"]})
    assert deleted.status_code == 200
    assert "ribosome-80s" not in {o["name"] for o in json.loads(demo_config.read_text())["pickable_objects"]}
    assert client.delete(f"{URL}/nope", params={"version": deleted.json()["version"]}).status_code == 404


@pytest.mark.parametrize(
    "fields, message",
    [
        ({"name": "bad name"}, "invalid"),
        ({"name": "Ribosome"}, "already exists"),
        ({"label": 0}, "reserved for background"),
        ({"color": [300, 0, 0, 255]}, "[0, 255]"),
        ({"radius": -1.0}, "positive"),
        ({"is_particle": False, "filament": {"polar": True}}, "particle"),
    ],
)
def test_invalid_changes_are_refused(client, demo_config, fields, message):
    before = demo_config.read_text()
    body, by_name = _types(client)
    response = client.post(URL, json=_payload(body["version"], **fields))
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert message in detail.lower() and not detail.lower().startswith("assertion")
    assert demo_config.read_text() == before


def test_label_must_be_unique(client):
    body, by_name = _types(client)
    response = client.post(URL, json=_payload(body["version"], label=by_name["ribosome"]["label"]))
    assert response.status_code == 422 and "already used" in response.json()["detail"]


def test_stale_version_is_a_conflict(client, demo_config):
    body, _ = _types(client)
    assert client.post(URL, json=_payload(body["version"])).status_code == 201
    stale = client.post(URL, json=_payload(body["version"], name="other", label=10))
    assert stale.status_code == 409
    assert "other" not in demo_config.read_text()


def test_read_only_config(client, demo_config):
    os.chmod(demo_config, 0o444)
    try:
        body, _ = _types(client)
        assert body["editable"] is False
        assert client.post(URL, json=_payload(body["version"])).status_code == 403
    finally:
        os.chmod(demo_config, 0o644)


def test_edits_on_disk_are_picked_up_and_other_settings_kept(client, demo_config):
    body, _ = _types(client)
    cfg = json.loads(demo_config.read_text())
    cfg["description"] = "edited by hand"
    cfg["pickable_objects"].append(
        {"name": "by-hand", "is_particle": True, "label": 42, "color": [1, 1, 1, 255], "radius": 10.0}
    )
    demo_config.write_text(json.dumps(cfg))

    # the stale version is refused, nothing is overwritten
    assert client.post(URL, json=_payload(body["version"])).status_code == 409
    assert "by-hand" in demo_config.read_text()
    # both listings see the hand edit
    fresh, by_name = _types(client)
    assert "by-hand" in by_name and any(o["name"] == "by-hand" for o in client.get("/api/objects").json())
    # a change on the fresh version keeps the rest of the file as it is
    assert client.post(URL, json=_payload(fresh["version"])).status_code == 201
    saved = json.loads(demo_config.read_text())
    assert saved["description"] == "edited by hand"
    assert {"by-hand", "proteasome"} <= {o["name"] for o in saved["pickable_objects"]}
