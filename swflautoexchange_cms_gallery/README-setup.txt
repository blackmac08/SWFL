
SWFL Auto Exchange — Netlify CMS Gallery (Recently Purchased Vehicles)
=====================================================================

What this adds
--------------
- A Netlify CMS admin at /admin where you can add vehicles (photo, title, date, notes).
- A JSON file (`/data/recent-purchases.json`) that CMS edits automatically.
- A small JS renderer that reads the JSON and displays a grid on your homepage.

Files to copy into your repo (preserving folders)
-------------------------------------------------
admin/index.html
admin/config.yml
data/recent-purchases.json
assets/js/gallery.js
assets/styles-gallery.css

Then paste the section snippet into your index.html just **below** the hero banner:
- snippets/recent-purchases-section.html  (open and copy/paste its contents)

Netlify setup (one-time)
------------------------
1) In your Netlify site, enable Identity:
   - Site Settings → Identity → Enable Identity
2) Enable Git Gateway:
   - Identity → Services → Enable Git Gateway
3) (Optional) Under Identity → Registration, set "Open" or "Invite only".
4) If "Invite only", use Identity → Invite users and invite your email.
5) Visit https://YOUR-SITE.com/admin and log in. You’ll see a “Recently Purchased” entry.
6) Click it → Edit → Add items to the “Vehicles” list. Upload a photo to /assets/uploads.
7) Publish changes. This writes to /data/recent-purchases.json in your repo.

How to place the gallery below the hero
---------------------------------------
- Open your index.html and find the end of your hero/banner section.
- Paste the contents of snippets/recent-purchases-section.html right under it.

Image sizes & tips
------------------
- Use landscape images around 1200–1600px wide for best quality/size balance.
- The CMS stores images in /assets/uploads by default; the JSON will reference them automatically.
- You can reorder vehicles in the CMS by dragging the list items.

Troubleshooting
---------------
- If /admin shows an auth error: ensure Identity is enabled and Git Gateway is connected.
- If the gallery doesn't populate: check that /data/recent-purchases.json exists on production and is valid JSON.
- To remove the sample items: open the CMS, delete the two sample entries, and publish.

Advanced (optional)
-------------------
- If you want multiple galleries (e.g., “Sold Boats” later), duplicate the collection in config.yml with a new file path and mount a second section using a second JS file.
- If you prefer showing most recent first, simply reverse in JS before rendering:
    // after data.vehicles loaded:
    data.vehicles.sort((a,b) => (b.date || '').localeCompare(a.date || ''));
- For Lighthouse performance, consider compressing images during upload or using Netlify Large Media/On-demand Builders later.
