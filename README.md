# Widgets

Eine persönliche Startseite als verschachteltes „Ordnersystem“: Widgets können
weitere Widgets oder Links enthalten, beliebig tief. Läuft komplett statisch auf
GitHub Pages, ohne Build-Schritt und ohne Abhängigkeiten.

- **`index.html`**: die Startseite. Kachel-Raster, Breadcrumb-Navigation, Suche über alle Ebenen.
- **`admin.html`**: der Editor. Widgets und Links anlegen, bearbeiten, verschieben, sortieren und löschen.
- **`data.json`**: alle Inhalte. Der Editor schreibt diese Datei über die GitHub API direkt ins Repo.

## Einrichtung

1. **GitHub Pages aktivieren:** Repo → *Settings* → *Pages* → *Deploy from a branch* →
   Branch `main`, Ordner `/ (root)` → *Save*.
   Die Seite liegt danach unter `https://<benutzer>.github.io/widgets/`.
2. **Token erstellen** (nur zum Bearbeiten nötig):
   [Fine-grained Personal Access Token](https://github.com/settings/personal-access-tokens/new)
   - *Repository access* → *Only select repositories* → `widgets`
   - *Permissions* → *Contents* → **Read and write**
3. `admin.html` öffnen → **⚙️ GitHub** → Token eintragen. Besitzer und Repo werden
   automatisch aus der URL erkannt. Der **Branch** muss der sein, aus dem Pages veröffentlicht.

Nach dem Speichern baut GitHub Pages die Seite neu. Änderungen sind meist nach
etwa einer Minute sichtbar.

## Hinweise

- Der Token wird nur im `localStorage` des jeweiligen Browsers gespeichert und nur an
  `api.github.com` gesendet. Auf einem fremden Gerät nach der Nutzung **Token vergessen** klicken.
- Die Startseite ist öffentlich lesbar (wie das Repo). Ändern kann nur, wer einen gültigen Token hat.
- Ungespeicherte Änderungen bleiben als Entwurf im Browser erhalten, falls der Tab geschlossen wird.
- **Strg/Cmd + S** speichert im Editor.
- Über *JSON exportieren / importieren* lassen sich Backups machen.
- Direktlinks: `index.html#/<widget-id>/<unter-widget-id>` und `admin.html#<id>`.

## Datenformat

```json
{
  "title": "Meine Widgets",
  "children": [
    {
      "id": "w-arbeit", "type": "widget", "title": "Arbeit", "icon": "💼", "description": "",
      "children": [
        { "id": "l-github", "type": "link", "title": "GitHub", "url": "https://github.com", "icon": "", "description": "" }
      ]
    }
  ]
}
```
