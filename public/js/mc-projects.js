/**
 * MeasureCraft local project store + version history
 * Keys: mc-projects (index), mc-project-{id} (payload + versions)
 * Designed for client-side SaaS readiness until a real backend is wired.
 */
(function (global) {
  'use strict';

  var INDEX_KEY = 'mc-projects';
  var PREFIX = 'mc-project-';
  var MAX_VERSIONS = 20;

  function uid() {
    return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function readIndex() {
    try {
      var raw = localStorage.getItem(INDEX_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (_) {
      return [];
    }
  }

  function writeIndex(list) {
    try {
      localStorage.setItem(INDEX_KEY, JSON.stringify(list));
    } catch (e) {
      console.warn('[MCProjects] index write failed', e);
    }
  }

  function readRecord(id) {
    try {
      var raw = localStorage.getItem(PREFIX + id);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function writeRecord(id, record) {
    try {
      localStorage.setItem(PREFIX + id, JSON.stringify(record));
      return true;
    } catch (e) {
      console.warn('[MCProjects] record write failed (quota?)', e);
      return false;
    }
  }

  function stripHeavyBackground(data) {
    if (!data || !data.backgroundImage) return data;
    var bg = data.backgroundImage;
    // Keep metadata; drop large data URLs from older versions to save quota
    var copy = Object.assign({}, data);
    if (bg && typeof bg.src === 'string' && bg.src.length > 200000) {
      copy.backgroundImage = {
        src: null,
        w: bg.w,
        h: bg.h,
        opacity: bg.opacity,
        visible: bg.visible,
        omitted: true
      };
    }
    return copy;
  }

  var MCProjects = {
    list: function () {
      return readIndex().slice().sort(function (a, b) {
        return (b.updatedAt || '').localeCompare(a.updatedAt || '');
      });
    },

    get: function (id) {
      return readRecord(id);
    },

    /**
     * Create or update a project snapshot.
     * opts: { id?, name, mode: 'pro'|'simple', note?, data }
     * Returns { id, version }
     */
    save: function (opts) {
      opts = opts || {};
      var index = readIndex();
      var id = opts.id;
      var now = new Date().toISOString();
      var name = (opts.name || (opts.data && opts.data.projectInfo && opts.data.projectInfo.name) || 'Untitled Project').trim();
      var mode = opts.mode || 'pro';
      var note = opts.note || '';
      var data = opts.data || {};

      var record;
      if (id) {
        record = readRecord(id);
      }
      if (!record) {
        id = id || uid();
        record = {
          id: id,
          name: name,
          mode: mode,
          createdAt: now,
          updatedAt: now,
          current: data,
          versions: []
        };
        index.push({
          id: id,
          name: name,
          mode: mode,
          status: (data.projectInfo && data.projectInfo.status) || 'Draft',
          client: (data.projectInfo && data.projectInfo.client) || '',
          updatedAt: now,
          createdAt: now,
          versionCount: 0,
          elementCount: Array.isArray(data.elements) ? data.elements.length : 0
        });
      } else {
        // Push previous current into versions
        if (record.current) {
          record.versions = record.versions || [];
          record.versions.unshift({
            id: 'v_' + Date.now().toString(36),
            savedAt: record.updatedAt || now,
            note: note || 'Auto-save',
            snapshot: stripHeavyBackground(record.current)
          });
          if (record.versions.length > MAX_VERSIONS) {
            record.versions = record.versions.slice(0, MAX_VERSIONS);
          }
        }
        record.name = name;
        record.mode = mode;
        record.updatedAt = now;
        record.current = data;

        // Update index entry
        var found = false;
        for (var i = 0; i < index.length; i++) {
          if (index[i].id === id) {
            index[i].name = name;
            index[i].mode = mode;
            index[i].status = (data.projectInfo && data.projectInfo.status) || index[i].status || 'Draft';
            index[i].client = (data.projectInfo && data.projectInfo.client) || '';
            index[i].updatedAt = now;
            index[i].versionCount = (record.versions || []).length;
            index[i].elementCount = Array.isArray(data.elements) ? data.elements.length : 0;
            found = true;
            break;
          }
        }
        if (!found) {
          index.push({
            id: id,
            name: name,
            mode: mode,
            status: (data.projectInfo && data.projectInfo.status) || 'Draft',
            client: (data.projectInfo && data.projectInfo.client) || '',
            updatedAt: now,
            createdAt: record.createdAt || now,
            versionCount: (record.versions || []).length,
            elementCount: Array.isArray(data.elements) ? data.elements.length : 0
          });
        }
      }

      writeRecord(id, record);
      writeIndex(index);
      try {
        localStorage.setItem('mc-active-project-id', id);
      } catch (_) {}

      return {
        id: id,
        versionCount: (record.versions || []).length,
        updatedAt: now
      };
    },

    listVersions: function (id) {
      var record = readRecord(id);
      if (!record) return [];
      return (record.versions || []).slice();
    },

    restoreVersion: function (id, versionId) {
      var record = readRecord(id);
      if (!record || !record.versions) return null;
      var ver = null;
      for (var i = 0; i < record.versions.length; i++) {
        if (record.versions[i].id === versionId) {
          ver = record.versions[i];
          break;
        }
      }
      if (!ver || !ver.snapshot) return null;
      // Save current as a version first, then restore
      return this.save({
        id: id,
        name: record.name,
        mode: record.mode,
        note: 'Restored from ' + (ver.savedAt || versionId),
        data: ver.snapshot
      });
    },

    remove: function (id) {
      try {
        localStorage.removeItem(PREFIX + id);
      } catch (_) {}
      var index = readIndex().filter(function (p) { return p.id !== id; });
      writeIndex(index);
      try {
        if (localStorage.getItem('mc-active-project-id') === id) {
          localStorage.removeItem('mc-active-project-id');
        }
      } catch (_) {}
    },

    getActiveId: function () {
      try {
        return localStorage.getItem('mc-active-project-id') || null;
      } catch (_) {
        return null;
      }
    },

    setActiveId: function (id) {
      try {
        if (id) localStorage.setItem('mc-active-project-id', id);
        else localStorage.removeItem('mc-active-project-id');
      } catch (_) {}
    }
  };

  global.MCProjects = MCProjects;
})(typeof window !== 'undefined' ? window : this);
