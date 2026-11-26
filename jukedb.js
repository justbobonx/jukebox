//shared library db code, used by the library window and the player

var JDB_DIR = "jukebox";	//app folder inside the main folder
var JDB_FILE = "library.db";	//library db file inside the app folder
var JDB_AUDIO_EXTS = [ "mp3", "m4a", "ogg", "wav", "flac" ];	//song files we keep
var JDB_WALK_PAR = 8;	//folders read at once while scanning
var JDB_IDB_NAME = "jukebox";	//browser db holding the folder handle
var JDB_IDB_STORE = "handles";
var JDB_IDB_KEY = "main";
var JDB_DRAG_TYPE = "application/x-jukebox-path";	//drag type for a library song
var JDB_DRAG_PREFIX = "jukebox-lib:";	//plain text drag marker for a library song

//folder handles we already found, by path
var jdb_dirs = {};


// folder handle, kept in the browser db ///////////

function jdb_idb_open( doneFunc )
{
	var req = indexedDB.open( JDB_IDB_NAME, 1 );
	req.onupgradeneeded = function()
	{
		req.result.createObjectStore( JDB_IDB_STORE );
	};
	req.onsuccess = function()
	{
		doneFunc( req.result );
	};
	req.onerror = function()
	{
		console.log( "jdb: browser db failed", req.error );
		doneFunc( null );
	};
}

function jdb_save_handle( handle, doneFunc )
{
	jdb_idb_open( function(idb)
	{
		if( !idb ){  if( doneFunc ){  doneFunc(false);  }  return;  }
		var tx = idb.transaction( JDB_IDB_STORE, "readwrite" );
		tx.objectStore( JDB_IDB_STORE ).put( handle, JDB_IDB_KEY );
		tx.oncomplete = function(){  if( doneFunc ){  doneFunc(true);  }  };
		tx.onerror = function(){  if( doneFunc ){  doneFunc(false);  }  };
	});
}

function jdb_load_handle( doneFunc )
{
	if( !window.indexedDB ){  doneFunc(null);  return;  }
	jdb_idb_open( function(idb)
	{
		if( !idb ){  doneFunc(null);  return;  }
		var tx = idb.transaction( JDB_IDB_STORE, "readonly" );
		var req = tx.objectStore( JDB_IDB_STORE ).get( JDB_IDB_KEY );
		req.onsuccess = function(){  doneFunc( req.result || null );  };
		req.onerror = function(){  doneFunc(null);  };
	});
}

//true if allowed, asks only when told to, asking needs a click
function jdb_check_perm( handle, mode, ask, doneFunc )
{
	if( !handle || !handle.queryPermission ){  doneFunc(false);  return;  }
	handle.queryPermission( { mode: mode } ).then( function(state)
	{
		if( state=="granted" ){  doneFunc(true);  return;  }
		if( !ask ){  doneFunc(false);  return;  }
		handle.requestPermission( { mode: mode } ).then( function(state2)
		{
			doneFunc( state2=="granted" );
		}, function(){  doneFunc(false);  });
	}, function(){  doneFunc(false);  });
}


// paths and files ///////////

function jdb_is_audio( name )
{
	var dot = name.lastIndexOf(".");
	if( dot<0 ){  return false;  }
	return JDB_AUDIO_EXTS.indexOf( name.substring(dot+1).toLowerCase() )>-1;
}

//file name part of a path
function jdb_base_name( path )
{
	var i = path.lastIndexOf("/");
	return i<0 ? path : path.substring(i+1);
}

//path to a File, null if it can't be found
function jdb_resolve( main, path, doneFunc )
{
	var parts = path.split("/");
	var fname = parts.pop();
	var i = 0;
	var dpath = "";
	var dir = main;
	
	function fail(err)
	{
		console.log( "jdb: can't open "+path, err );
		doneFunc(null);
	}
	
	function next_dir()
	{
		if( i>=parts.length ){
			dir.getFileHandle( fname ).then( function(fh)
			{
				return fh.getFile();
			}).then( function(file)
			{
				doneFunc(file);
			}, fail );
			return;
		}
		dpath = dpath=="" ? parts[i] : dpath+"/"+parts[i];
		i++;
		if( jdb_dirs[dpath] ){
			dir = jdb_dirs[dpath];
			next_dir();
			return;
		}
		dir.getDirectoryHandle( parts[i-1] ).then( function(dh)
		{
			jdb_dirs[dpath] = dh;
			dir = dh;
			next_dir();
		}, fail );
	}
	next_dir();
}


// db file ///////////

function jdb_create_tables( db )
{
	db.run( "CREATE TABLE IF NOT EXISTS folders (id INTEGER PRIMARY KEY, path TEXT UNIQUE, hidden INTEGER DEFAULT 0)" );
	db.run( "CREATE TABLE IF NOT EXISTS songs (id INTEGER PRIMARY KEY, folder_id INTEGER, path TEXT UNIQUE, size INTEGER, mtime INTEGER,"
		+" title TEXT, artist TEXT, album TEXT, year TEXT, track INTEGER, tags_read INTEGER DEFAULT 0, missing INTEGER DEFAULT 0)" );
	db.run( "CREATE INDEX IF NOT EXISTS songs_folder ON songs(folder_id)" );
	jdb_upgrade_tables( db );
}

//add new columns to an older library db
function jdb_upgrade_tables( db )
{
	var cols = jdb_rows( db, "PRAGMA table_info(songs)" );
	var has_track = false;
	var i;
	for( i=0; i<cols.length; i++ ){
		if( cols[i].name=="track" ){  has_track = true;  break;  }
	}
	if( !has_track ){
		db.run( "ALTER TABLE songs ADD COLUMN track INTEGER" );
	}
}

//load the library db, or a new empty one, error if the main folder has no app folder
function jdb_open( SQL, main, doneFunc )
{
	main.getDirectoryHandle( JDB_DIR ).then( function(app)
	{
		app.getFileHandle( JDB_FILE ).then( function(fh)
		{
			return fh.getFile();
		}).then( function(file)
		{
			return file.arrayBuffer();
		}).then( function(buf)
		{
			var db = new SQL.Database( new Uint8Array(buf) );
			jdb_create_tables( db );
			jdb_refresh_vis( db );
			doneFunc( db, false, null );
		}, function(err)
		{
			//no db yet, start fresh
			if( err && err.name=="NotFoundError" ){
				var db = new SQL.Database();
				jdb_create_tables( db );
				jdb_refresh_vis( db );
				doneFunc( db, true, null );
				return;
			}
			doneFunc( null, false, err );
		});
	}, function(err)
	{
		doneFunc( null, false, "no "+JDB_DIR+" folder in "+main.name );
	});
}

//write the db back to its file
function jdb_save( db, main, doneFunc )
{
	var data = db.export();
	var writer = null;
	main.getDirectoryHandle( JDB_DIR ).then( function(app)
	{
		return app.getFileHandle( JDB_FILE, { create: true } );
	}).then( function(fh)
	{
		return fh.createWritable();
	}).then( function(w)
	{
		writer = w;
		return w.write( data );
	}).then( function()
	{
		return writer.close();
	}).then( function()
	{
		doneFunc(null);
	}, function(err)
	{
		console.log( "jdb: save failed", err );
		if( writer ){  writer.abort();  }
		doneFunc( err || "save failed" );
	});
}


// scan ///////////

//walk every folder under main, find song files with size and time
function jdb_scan( main, progressFunc, doneFunc )
{
	var scan = {
		files: [],	//path, dir, size, mtime
		dirs: {},	//folders with songs right in them
		tops: {}	//top folders, true when songs anywhere below
	};
	var queue = [ { h: main, path: "" } ];
	var active = 0;
	var done = false;
	
	function pump()
	{
		while( active<JDB_WALK_PAR && queue.length>0 ){
			active++;
			walk_dir( queue.shift() );
		}
		if( active==0 && queue.length==0 && !done ){
			done = true;
			doneFunc( scan );
		}
	}
	
	function walk_dir( d )
	{
		var it = d.h.values();
		var pend = 0;
		var listed = false;
		
		function check()
		{
			if( !listed || pend>0 ){  return;  }
			active--;
			if( progressFunc ){  progressFunc( scan.files.length );  }
			pump();
		}
		
		function got_file( e, p )
		{
			pend++;
			e.getFile().then( function(f)
			{
				scan.files.push( { path: p, dir: d.path, size: f.size, mtime: f.lastModified } );
				scan.dirs[d.path] = true;
				if( d.path!="" ){  scan.tops[ p.split("/")[0] ] = true;  }
				pend--;
				check();
			}, function(err)
			{
				console.log( "jdb: can't read "+p, err );
				pend--;
				check();
			});
		}
		
		function step()
		{
			it.next().then( function(r)
			{
				if( r.done ){
					listed = true;
					check();
					return;
				}
				var e = r.value;
				var p = d.path=="" ? e.name : d.path+"/"+e.name;
				if( e.kind=="directory" ){
					jdb_dirs[p] = e;
					if( d.path=="" && !scan.tops[p] ){  scan.tops[p] = false;  }
					queue.push( { h: e, path: p } );
				}else
				if( jdb_is_audio(e.name) ){
					got_file( e, p );
				}
				step();
			}, function(err)
			{
				console.log( "jdb: can't list "+d.path, err );
				listed = true;
				check();
			});
		}
		step();
	}
	
	pump();
}

//rows from a query as objects
function jdb_rows( db, sql, params )
{
	var st = db.prepare( sql );
	var rows = [];
	if( params ){  st.bind( params );  }
	while( st.step() ){
		rows.push( st.getAsObject() );
	}
	st.free();
	return rows;
}

//put a scan into the db, ids stay, lost songs only marked missing
function jdb_apply_scan( db, scan )
{
	var res = { found: scan.files.length, added: 0, changed: 0, lost: 0, back: 0, new_folders: 0 };
	var folders = {};
	var rows, i, p, f, o, fid;
	var sts = [];
	
	function prep( sql )
	{
		var st = db.prepare( sql );
		sts.push( st );
		return st;
	}
	
	db.run( "BEGIN" );
	try{
		//folders, new ones only, top folders with no songs start hidden
		rows = jdb_rows( db, "SELECT id, path FROM folders" );
		for( i=0; i<rows.length; i++ ){  folders[rows[i].path] = rows[i].id;  }
		var want = {};
		for( p in scan.tops ){  want[p] = true;  }
		for( p in scan.dirs ){  want[p] = true;  }
		var insF = prep( "INSERT INTO folders (path, hidden) VALUES (?, ?)" );
		for( p in want ){
			if( folders[p]!=undefined ){  continue;  }
			insF.run( [ p, ( scan.tops[p]===false ) ? 1 : 0 ] );
			res.new_folders++;
		}
		rows = jdb_rows( db, "SELECT id, path FROM folders" );
		for( i=0; i<rows.length; i++ ){  folders[rows[i].path] = rows[i].id;  }
		
		//songs
		var old = {};
		rows = jdb_rows( db, "SELECT id, path, folder_id, size, mtime, missing FROM songs" );
		for( i=0; i<rows.length; i++ ){  old[rows[i].path] = rows[i];  }
		var seen = {};
		var insS = prep( "INSERT INTO songs (folder_id, path, size, mtime) VALUES (?, ?, ?, ?)" );
		var updS = prep( "UPDATE songs SET folder_id=?, missing=0 WHERE id=?" );
		var chgS = prep( "UPDATE songs SET folder_id=?, size=?, mtime=?, missing=0, tags_read=0 WHERE id=?" );
		var lostS = prep( "UPDATE songs SET missing=1 WHERE id=?" );
		
		for( i=0; i<scan.files.length; i++ ){
			f = scan.files[i];
			fid = folders[f.dir];
			o = old[f.path];
			if( !o ){
				insS.run( [ fid, f.path, f.size, f.mtime ] );
				res.added++;
				continue;
			}
			seen[o.id] = true;
			if( o.size!=f.size || o.mtime!=f.mtime ){
				chgS.run( [ fid, f.size, f.mtime, o.id ] );
				res.changed++;
			}else
			if( o.missing || o.folder_id!=fid ){
				updS.run( [ fid, o.id ] );
			}
			if( o.missing ){  res.back++;  }
		}
		for( p in old ){
			o = old[p];
			if( !seen[o.id] && !o.missing ){
				lostS.run( [ o.id ] );
				res.lost++;
			}
		}
		db.run( "COMMIT" );
	}catch( ex ){
		console.log( "jdb: scan save failed", ex );
		db.run( "ROLLBACK" );
		res.error = ""+ex;
	}
	for( i=0; i<sts.length; i++ ){  sts[i].free();  }
	if( !res.error ){  jdb_refresh_vis( db );  }
	return res;
}

//rebuild the temp visible folders list so song queries can use the folder index
function jdb_refresh_vis( db )
{
	var rows = jdb_rows( db, "SELECT id, path, hidden FROM folders" );
	var hid = [];
	var i, j, r, bad;
	for( i=0; i<rows.length; i++ ){
		if( rows[i].hidden && rows[i].path!="" ){  hid.push( rows[i].path );  }
	}
	db.run( "DROP TABLE IF EXISTS temp.vis_folders" );
	db.run( "CREATE TEMP TABLE vis_folders (id INTEGER PRIMARY KEY, path TEXT)" );
	db.run( "BEGIN" );
	var ins = db.prepare( "INSERT INTO temp.vis_folders (id, path) VALUES (?, ?)" );
	for( i=0; i<rows.length; i++ ){
		r = rows[i];
		if( r.hidden ){  continue;  }
		bad = false;
		for( j=0; j<hid.length; j++ ){
			if( r.path==hid[j] || r.path.indexOf(hid[j]+"/")==0 ){  bad = true;  break;  }
		}
		if( !bad ){  ins.run( [ r.id, r.path ] );  }
	}
	ins.free();
	db.run( "COMMIT" );
}

//sql test that a song row, by its path, is not under a hidden folder
function jdb_not_hidden_sql( alias )
{
	return "NOT EXISTS (SELECT 1 FROM folders h WHERE h.hidden=1 AND substr("+alias+".path,1,length(h.path)+1)=h.path||'/')";
}
