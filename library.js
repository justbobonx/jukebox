

$( document ).ready(function() {
   lib_onLoad();
});


function lib_onLoad()
{
	var TAG_LOADS = 4;	//tag reads at once
	var TAG_BATCH = 500;	//tag reads per transaction and save
	var LIST_MAX = 500;	//most songs shown in the list
	var SEARCH_MS = 150;	//typing pause before searching
	var WHO_COLS = [ "#993333", "#338833", "#3333bb", "#9922aa" ];	//same as the player drop boxes
	
	var SQL = null;
	var db = null;
	var main = null;	//main music folder
	var saved_h = null;	//folder from last time, waiting for a click to allow it
	
	var busy = false;
	var last_save = "";
	
	var list_rows = [];
	var list_match = 0;	//songs matching the current filter
	var folder_paths = {};	//folder id to path
	var search_timer = null;
	
	$(document).on("keydown", function(evt)
	{
		if( busy ){
			evt.preventDefault();
			evt.stopPropagation();
		}
	});
	
	function show_busy( msg, pct )
	{
		busy = true;
		if( document.activeElement && document.activeElement.blur ){  document.activeElement.blur();  }
		$("#lib_overlay_msg").text( msg );
		$("#lib_prog_fill").css( "width", (pct || 0)+"%" );
		$("#lib_overlay").css( "display", "flex" );
	}
	
	function hide_busy()
	{
		busy = false;
		$("#lib_overlay").hide();
	}
	
	
	// who's browsing ///////////
	
	var lib_who = $("#lib_who");
	var who = parseInt( $.cookie("lib_who") || 0 ) || 0;
	set_who( who );
	lib_who.on("change", function()
	{
		set_who( parseInt(this.value) );
		lib_who.blur();
	});
	
	function set_who(w)
	{
		who = w;
		lib_who.val( who );
		lib_who.css( "background", WHO_COLS[who] );
		$.cookie( "lib_who", who, { expires: 3650 } );
	}
	
	function status(s)
	{
		$("#lib_status").text(s);
	}
	
	
	// opening the folder ///////////
	
	if( !window.showDirectoryPicker ){
		status( "this browser can't open folders" );
		return;
	}
	
	jdb_load_handle( function(h)
	{
		if( !h ){
			show_pick( null );
			return;
		}
		jdb_check_perm( h, "readwrite", false, function(ok)
		{
			if( ok ){
				start( h );
			}else{
				show_pick( h );
			}
		});
	});
	
	function show_pick(h)
	{
		saved_h = h;
		$("#lib_main").hide();
		$("#lib_pick").show();
		if( h ){
			$("#btn_lib_open").text( "open "+h.name ).show();
		}else{
			$("#btn_lib_open").hide();
		}
	}
	
	//allowing a saved folder needs a click
	$("#btn_lib_open").on("click", function()
	{
		if( !saved_h ){  return;  }
		jdb_check_perm( saved_h, "readwrite", true, function(ok)
		{
			if( ok ){
				start( saved_h );
			}else{
				status( "not allowed, pick the folder again" );
			}
		});
	});
	
	$("#btn_lib_pick").on("click", function()
	{
		window.showDirectoryPicker( { mode: "readwrite" } ).then( function(h)
		{
			jdb_check_perm( h, "readwrite", true, function(ok)
			{
				if( ok ){
					start( h );
				}else{
					status( "need permission to save the library" );
				}
			});
		}, function(err)
		{
			console.log( "lib: pick canceled", err );
		});
	});
	
	function start(h)
	{
		main = h;
		jdb_dirs = {};
		$("#lib_pick").hide();
		status( "loading library..." );
		
		initSqlJs( { locateFile: function(f){  return f;  } } ).then( function(S)
		{
			SQL = S;
			jdb_open( SQL, main, function(d, is_new, err)
			{
				if( err ){
					status( "can't open the library: "+err+", pick the main music folder" );
					main = null;
					show_pick( null );
					return;
				}
				db = d;
				//only a folder that opened is remembered
				jdb_save_handle( main );
				status( "" );
				$("#lib_main").show();
				if( is_new ){
					scan();
				}else{
					run_pending_tags( function()
					{
						refresh_all();
					});
				}
			});
		}, function(err)
		{
			status( "sql.js failed to load: "+err );
		});
	}
	
	//player asks for a song file
	function lib_get_file( path, doneFunc )
	{
		if( !main ){  doneFunc(null);  return;  }
		jdb_resolve( main, path, doneFunc );
	}
	window.lib_get_file = lib_get_file;
	
	
	// scan ///////////
	
	$("#btn_lib_scan").on("click", function()
	{
		scan();
	});
	
	function scan()
	{
		if( busy || !db ){  return;  }
		show_busy( "scanning folders...", 0 );
		jdb_scan( main, function(n)
		{
			show_busy( "scanning folders... "+n+" songs", 0 );
		}, function(s)
		{
			var res = jdb_apply_scan( db, s );
			//fill track on songs tagged before we stored it
			db.run( "UPDATE songs SET tags_read=0 WHERE missing=0 AND track IS NULL" );
			status( "scan done: "+res.found+" found, "+res.added+" new, "+res.changed+" changed, "
				+res.lost+" missing, "+res.back+" back"+( res.error ? ", error "+res.error : "" ) );
			save_db( function()
			{
				run_pending_tags( function()
				{
					refresh_all();
				});
			});
		});
	}
	
	
	// tags ///////////
	
	var tag_t0 = 0;
	var tag_left = "";
	
	function tag_msg( n, total )
	{
		return "tags "+n+" of "+total+tag_left;
	}
	
	//elapsed so far, then time left at that pace
	function tag_tick( done, total )
	{
		if( done==0 ){  return;  }
		var left = (Date.now()-tag_t0)/done * (total-done);
		var sec = Math.round( left/1000 );
		if( sec<0 ){  sec = 0;  }
		var m = Math.floor( sec/60 );
		var s = sec%60;
		tag_left = " ("+m+":"+(s<10 ? "0" : "")+s+")";
	}
	
	function run_pending_tags( doneFunc )
	{
		var todo = jdb_rows( db, "SELECT s.id, s.path FROM songs s WHERE s.missing=0 AND s.tags_read=0 AND s.folder_id IN (SELECT id FROM vis_folders) ORDER BY s.id" );
		var total = todo.length;
		if( total==0 ){
			hide_busy();
			if( doneFunc ){  doneFunc();  }
			return;
		}
		var done = 0;
		var offset = 0;
		tag_t0 = Date.now();
		tag_left = "";
		show_busy( tag_msg( 0, total ), 0 );
		
		function next_batch()
		{
			//estimate after a batch and its save, not before the first
			if( offset>0 ){
				tag_tick( done, total );
				show_busy( tag_msg( done, total ), (done/total)*100 );
			}
			if( offset>=total ){
				hide_busy();
				if( doneFunc ){  doneFunc();  }
				return;
			}
			var batch = todo.slice( offset, offset+TAG_BATCH );
			offset += batch.length;
			read_tag_batch( batch, total, done, function(updates, new_done)
			{
				done = new_done;
				apply_tag_batch( updates );
				save_db( next_batch );
			});
		}
		next_batch();
	}
	
	function read_tag_batch( batch, total, done, doneFunc )
	{
		var bi = 0;
		var active = 0;
		var updates = [];
		
		function pump()
		{
			while( active<TAG_LOADS && bi<batch.length ){
				active++;
				read_one( batch[bi++] );
			}
			if( active==0 && bi>=batch.length ){
				doneFunc( updates, done );
			}
		}
		
		function finish_one( upd )
		{
			updates.push( upd );
			active--;
			done++;
			show_busy( tag_msg( done, total ), (done/total)*100 );
			pump();
		}
		
		function read_one( s )
		{
			jdb_resolve( main, s.path, function(file)
			{
				//gone since the scan
				if( !file ){
					finish_one( { id: s.id, missing: 1 } );
					return;
				}
				jsmediatags.read( file, {
					onSuccess: function(res)
					{
						var t = res.tags;
						finish_one( {
							id: s.id,
							title: t.title || null,
							artist: t.artist || null,
							album: t.album || null,
							year: t.year ? ""+t.year : null,
							track: lib_parse_track( t.track )
						});
					},
					onError: function()
					{
						//no tags, filename it is
						finish_one( { id: s.id } );
					}
				});
			});
		}
		pump();
	}
	
	function apply_tag_batch( updates )
	{
		var stTag = db.prepare( "UPDATE songs SET title=?, artist=?, album=?, year=?, track=?, tags_read=1 WHERE id=?" );
		var stMiss = db.prepare( "UPDATE songs SET missing=1 WHERE id=?" );
		var stNone = db.prepare( "UPDATE songs SET tags_read=1 WHERE id=?" );
		db.run( "BEGIN" );
		try{
			for( var i=0; i<updates.length; i++ ){
				var u = updates[i];
				if( u.missing ){
					stMiss.run( [ u.id ] );
				}else
				if( u.title!==undefined ){
					stTag.run( [ u.title, u.artist, u.album, u.year, u.track, u.id ] );
				}else{
					stNone.run( [ u.id ] );
				}
			}
			db.run( "COMMIT" );
		}catch( ex ){
			console.log( "lib: tag batch save failed", ex );
			db.run( "ROLLBACK" );
		}
		stTag.free();
		stMiss.free();
		stNone.free();
	}
	
	
	// saving ///////////
	
	function save_db( doneFunc )
	{
		if( !db || !main ){
			if( doneFunc ){  doneFunc();  }
			return;
		}
		jdb_save( db, main, function(err)
		{
			if( err ){
				status( "save failed: "+err );
			}else{
				last_save = new Date().toLocaleTimeString();
			}
			if( doneFunc ){  doneFunc();  }
		});
	}
	
	
	// folders ///////////
	
	$("#lib_folder").on("change", function()
	{
		refresh_list();
	});
	
	$("#lib_sort").on("change", function()
	{
		refresh_list();
	});
	
	$("#btn_lib_hide").on("click", function()
	{
		var id = $("#lib_folder").val();
		if( busy || !db || !id ){  return;  }
		db.run( "UPDATE folders SET hidden=1 WHERE id=?", [ parseInt(id) ] );
		$("#lib_folder").val("");
		jdb_refresh_vis( db );
		refresh_all();
		save_db( refresh_counts );
	});
	
	$("#btn_lib_unhide").on("click", function()
	{
		var id = $("#lib_hidden").val();
		if( busy || !db || !id ){  return;  }
		db.run( "UPDATE folders SET hidden=0 WHERE id=?", [ parseInt(id) ] );
		jdb_refresh_vis( db );
		save_db( function()
		{
			run_pending_tags( function()
			{
				refresh_all();
			});
		});
	});
	
	function refresh_folders()
	{
		var sel = $("#lib_folder").val();
		var rows = jdb_rows( db, "SELECT id, path FROM vis_folders WHERE path!='' ORDER BY path" );
		var htmls = "<option value=''>all folders</option>";
		folder_paths = {};
		for( var i=0; i<rows.length; i++ ){
			folder_paths[rows[i].id] = rows[i].path;
			htmls += "<option value='"+rows[i].id+"'>"+lib_esc( rows[i].path )+"</option>";
		}
		$("#lib_folder").html( htmls );
		$("#lib_folder").val( folder_paths[sel]!=undefined ? sel : "" );
		
		rows = jdb_rows( db, "SELECT id, path FROM folders WHERE hidden=1 ORDER BY path" );
		htmls = rows.length ? "" : "<option value=''>no hidden folders</option>";
		for( var i=0; i<rows.length; i++ ){
			htmls += "<option value='"+rows[i].id+"'>hidden: "+lib_esc( rows[i].path )+"</option>";
		}
		$("#lib_hidden").html( htmls );
	}
	
	
	// list ///////////
	
	$("#lib_search").on("input", function()
	{
		clearTimeout( search_timer );
		search_timer = setTimeout( refresh_list, SEARCH_MS );
	});
	
	function refresh_all()
	{
		if( !db ){  return;  }
		refresh_folders();
		refresh_list();
	}
	
	function refresh_counts()
	{
		if( !db ){  return;  }
		var r = jdb_rows( db, "SELECT sum(s.missing=0) AS songs, sum(s.missing=1) AS lost, sum(s.missing=0 AND s.tags_read=0) AS pend"
			+" FROM songs s WHERE s.folder_id IN (SELECT id FROM vis_folders)" )[0];
		var shown;
		if( list_match>LIST_MAX ){
			shown = LIST_MAX+" of "+list_match+" shown";
		}else{
			shown = list_match+" songs";
		}
		var htmls = shown+" &nbsp; "+( r.lost || 0 )+" missing &nbsp; "+( r.pend || 0 )+" tags pending";
		if( last_save!="" ){  htmls += " &nbsp; <span style='color:#888888;'>saved "+last_save+"</span>";  }
		$("#lib_counts").html( htmls );
	}
	
	//current folder and search, same for the list and its count
	function list_where()
	{
		var where = "s.missing=0";
		var params = [];
		
		//in a folder, any depth
		var fpath = folder_paths[ $("#lib_folder").val() ];
		if( fpath ){
			where += " AND (vf.path=? OR substr(vf.path,1,?)=?)";
			params.push( fpath, fpath.length+1, fpath+"/" );
		}
		
		//every word has to match somewhere
		var words = $.trim( $("#lib_search").val() ).split( /\s+/ );
		for( var i=0; i<words.length; i++ ){
			if( words[i]=="" ){  continue;  }
			var like = "%"+lib_like_esc( words[i] )+"%";
			where += " AND (s.title LIKE ? ESCAPE '\\' OR s.artist LIKE ? ESCAPE '\\' OR s.path LIKE ? ESCAPE '\\')";
			params.push( like, like, like );
		}
		return { where: where, params: params };
	}
	
	var last_where_key = "";
	
	function refresh_list()
	{
		if( !db ){  return;  }
		var q = list_where();
		var from = " songs s JOIN vis_folders vf ON vf.id=s.folder_id ";
		var key = q.where+"\t"+q.params.join("\t");
		if( key!=last_where_key ){
			list_match = jdb_rows( db, "SELECT count(*) AS n FROM"+from+"WHERE "+q.where, q.params )[0].n || 0;
			last_where_key = key;
		}
		list_rows = jdb_rows( db, "SELECT s.id, s.path, s.title, s.artist, s.album, s.year, s.track FROM"+from+"WHERE "+q.where
			+" ORDER BY "+list_order()+" LIMIT "+LIST_MAX, q.params );
		
		var sort = $("#lib_sort").val() || "artist_song";
		var htmls = "";
		for( var i=0; i<list_rows.length; i++ ){
			htmls += "<div class='lib_song' draggable='true' data-i='"+i+"'>"+song_line( list_rows[i], sort )+"</div>";
		}
		$("#lib_list").html( htmls );
		refresh_counts();
	}
	
	//order clause for the current sort, blanks last, then title, then path
	function list_order()
	{
		var sort = $("#lib_sort").val() || "artist_song";
		var song = "CASE WHEN s.title IS NOT NULL AND s.title!='' THEN s.title ELSE "+sql_filename()+" END";
		var parts = [];
		var fields = sort_fields( sort );
		var i, f;
		for( i=0; i<fields.length; i++ ){
			f = fields[i];
			if( f=="track" ){
				parts.push( "CASE WHEN s.track IS NULL THEN 1 ELSE 0 END" );
				parts.push( "s.track" );
			}else
			if( f=="artist" ){  parts.push( sql_text_key("s.artist") );  }else
			if( f=="album" ){  parts.push( sql_text_key("s.album") );  }else
			if( f=="year" ){  parts.push( sql_text_key("s.year") );  }else
			if( f=="folder" ){  parts.push( sql_text_key("vf.path") );  }else
			if( f=="filename" ){  parts.push( sql_text_key( sql_filename() ) );  }else
			if( f=="song" ){  parts.push( sql_text_key( song ) );  }
		}
		parts.push( "s.title COLLATE NOCASE" );
		parts.push( "s.path" );
		return parts.join( ", " );
	}
	
	function sql_filename()
	{
		return "CASE WHEN vf.path IS NULL OR vf.path='' THEN s.path ELSE substr(s.path, length(vf.path)+2) END";
	}
	
	//blank or missing values go last, then the text itself
	function sql_text_key( expr )
	{
		return "CASE WHEN ("+expr+") IS NULL OR ("+expr+")='' THEN 1 ELSE 0 END, ("+expr+") COLLATE NOCASE";
	}
	
	function sort_fields( sort )
	{
		if( sort=="artist_album_track" ){  return ["artist","album","track"];  }
		if( sort=="song" ){  return ["song"];  }
		if( sort=="year_artist_song" ){  return ["year","artist","song"];  }
		if( sort=="folder_artist_song" ){  return ["folder","artist","song"];  }
		if( sort=="folder_track" ){  return ["folder","track"];  }
		if( sort=="folder_song" ){  return ["folder","song"];  }
		if( sort=="filename" ){  return ["filename"];  }
		return ["artist","song"];
	}
	
	function song_line( row, sort )
	{
		var fields = sort_fields( sort );
		var in_sort = {};
		var parts = [];
		var i, f, v, fn, extras, line;
		fn = jdb_base_name( row.path );
		for( i=0; i<fields.length; i++ ){
			f = fields[i];
			in_sort[f] = true;
			v = sort_field_value( row, f, fn );
			if( v!="" ){  parts.push( v );  }
		}
		if( !in_sort.artist && row.artist ){  parts.push( row.artist );  }
		if( !in_sort.song ){
			if( row.title ){
				parts.push( row.title );
			}else
			if( !in_sort.filename ){
				parts.push( fn );
			}
		}
		if( !row.artist && !row.title && !in_sort.filename ){
			for( i=0; i<parts.length; i++ ){
				if( parts[i]==fn ){  break;  }
			}
			if( i==parts.length ){  parts.push( fn );  }
		}
		if( parts.length==0 ){  parts.push( fn );  }
		line = lib_esc( parts.join(" - ") );
		extras = [];
		if( !in_sort.album && row.album ){  extras.push( row.album );  }
		if( !in_sort.year && row.year ){  extras.push( row.year );  }
		if( extras.length>0 ){
			line += "<span class='lib_extra'>["+lib_esc( extras.join(", ") )+"]</span>";
		}
		return line;
	}
	
	function sort_field_value( row, key, fn )
	{
		if( key=="artist" ){  return row.artist || "";  }
		if( key=="album" ){  return row.album || "";  }
		if( key=="year" ){  return row.year || "";  }
		if( key=="song" ){  return row.title || fn;  }
		if( key=="folder" ){
			var slash = row.path.lastIndexOf("/");
			return slash<0 ? "" : row.path.substring( 0, slash );
		}
		if( key=="filename" ){  return fn;  }
		if( key=="track" ){  return lib_pad_track( row.track );  }
		return "";
	}
	
	
	// adding songs to the player ///////////
	
	$("#lib_list").on("click", ".lib_song", function()
	{
		var row = list_rows[ $(this).data("i") ];
		var el = $(this);
		if( !row ){  return;  }
		var op = window.opener;
		if( !op || op.closed || !op.jb_add_file ){
			status( "player not found, open the library from the player" );
			return;
		}
		jdb_resolve( main, row.path, function(file)
		{
			if( !file ){
				status( "can't open "+row.path );
				return;
			}
			if( op.jb_add_file( file, who ) ){
				//show it went in
				el.addClass( "lib_added" );
				setTimeout( function(){  el.removeClass( "lib_added" );  }, 400 );
			}else{
				status( "player is locked" );
			}
		});
	});
	
	//player tells library drags from other text by the type and marker
	$("#lib_list").on("dragstart", ".lib_song", function(evt)
	{
		var row = list_rows[ $(this).data("i") ];
		if( !row ){  return;  }
		var dt = evt.originalEvent.dataTransfer;
		dt.setData( JDB_DRAG_TYPE, row.path );
		dt.setData( "text/plain", JDB_DRAG_PREFIX+row.path );
		dt.effectAllowed = "copy";
	});
}


//track number from a tag, "3/12" is 3
function lib_parse_track( v )
{
	if( v==null || v==="" ){  return null;  }
	if( typeof v=="object" && v.data!=undefined ){  v = v.data;  }
	var n = parseInt( String(v), 10 );
	if( isNaN(n) ){  return null;  }
	return n;
}

//track for display, always at least two digits
function lib_pad_track( t )
{
	if( t==null || t==="" ){  return "";  }
	var n = parseInt( t, 10 );
	if( isNaN(n) ){  return "";  }
	return (n<10 ? "0" : "")+n;
}

//text safe for html
function lib_esc( s )
{
	return String(s).replace( /&/g, "&amp;" ).replace( /</g, "&lt;" ).replace( />/g, "&gt;" ).replace( /"/g, "&quot;" ).replace( /'/g, "&#39;" );
}

//text safe inside a like pattern
function lib_like_esc( s )
{
	return s.replace( /\\/g, "\\\\" ).replace( /%/g, "\\%" ).replace( /_/g, "\\_" );
}
