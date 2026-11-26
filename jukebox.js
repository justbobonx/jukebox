

$( document ).ready(function() {
   onLoad();
});


function onLoad()
{
	var indev = getUrlParam( 'indev', false );
	var stationlist;
	var cur_station = 1;
	var cur_song = null;
	var cur_song_a = null;
	var next_song = null;
	var next_song_a = null;
	var next_req = 0;	//bumped each next song request, older ones are stale
	var play_on_load = false;	//next was hit before next song loaded
	var RETRY_MS = 3000;	//wait before retrying a failed next song
	var MAX_LOADS = 10;	//max song files loading at once
	var AUDIO_EXTS = [ "mp3", "m4a", "ogg", "wav", "flac" ];	//dropped files we accept
	var LIB_WIN_OPTS = "width=900,height=800";	//library window size
	
	cur_song_d=null;
	
	var song_dur=100;
	var cur_song_loc=0;
	
	var all_swirls = 0;

	var swirl_dir = "./swirls/";
	var no_covers = ["swirl_1.gif","swirl_2.gif","swirl_3.gif","swirl_4.gif","swirl_5.gif","swirl_6.gif","swirl_7.gif","swirl_8.gif"
					 ,"swirl_9.gif","swirl_10.gif","swirl_11.gif","swirl_12.gif","swirl_13.gif","swirl_14.gif","swirl_15.gif","swirl_16.gif"
					 ,"swirl_17.gif","swirl_18.gif","swirl_19.gif","swirl_20.gif","swirl_21.gif","swirl_22.gif","swirl_23.gif","swirl_24.gif"
					 ,"swirl_25.gif","swirl_26.gif","swirl_27.gif","swirl_28.gif"];
	//var no_covers = ["swirl_25.gif","swirl_26.gif","swirl_27.gif","swirl_28.gif"];
	no_covers_l=no_covers.length;
	no_covers_i=Math.floor(Math.random()*no_covers_l);
	
	var song_list = [];	

	

	var btn_play = $("#btn_play");
	btn_play.on("mousedown", function()
	{
		play_pause();		
	});
	
	var btn_next = $("#btn_next");
	btn_next.on("mousedown", function()
	{
		if( this.disabled ){  return;  }
		play_next();
	});
	
	var btn_back = $("#btn_back");
	btn_back.on("mousedown", function(evt)
	{		
		//shift in playlist, replay last heard song, current goes back like never picked
		if( evt.shiftKey ){
			var j = played.length-1;
			while( j>-1 && played[j].bad ){  j--;  }
			if( j<0 ){  return;  }
			var back_song = played.splice(j,1)[0];
			var added = 1;
			if( is_pl_song(cur_song) ){
				listers[cur_song.who].played--;
				pl_end_song(cur_song);
				playlist.unshift(cur_song);
				cur_song=null;
				added++;
			}
			//replay doesn't count as a new play, pl_play_next adds it back
			listers[back_song.who].played--;
			playlist.unshift(back_song);
			//queue shifted, move the nexts with it
			for( var i=0; i<listers.length; i++ ){
				if( listers[i].forced_next>-1 ){  listers[i].forced_next += added;  }
			}
			pre_load_pick=-1;
			pl_play_next(0);
			return;
		}
		if( cur_song_a ){  cur_song_a.seek(0);  }
	});
	
	var minimized = getCVal( "minimized", false )=="true";
	//playlist shown, or next radio song shown
	var pl_on = getCVal( "pl_on", "true" )=="true";
	var btn_minmax = $("#btn_minmax");
	btn_minmax.on("mousedown", function()
	{
		setMinimized( !minimized );
	});
	
	var btn_pllist = $("#btn_pllist");
	btn_pllist.on("mousedown", function()
	{
		setPlOn( !pl_on );
	});
	
	//library in its own window, it adds songs back to us
	var lib_win = null;
	var btn_lib = $("#btn_lib");
	btn_lib.on("mousedown", function()
	{
		//already open, just bring it forward
		if( lib_win && !lib_win.closed ){
			lib_win.focus();
		}else{
			lib_win = window.open( "library.html", "jb_library", LIB_WIN_OPTS );
		}
	});
	
	function setMinimized(m)
	{
		minimized=m;
		setCVal( "minimized", minimized );		
		
		$("#cover_holder").toggle(!minimized);
		
		//next song only with playlist off, minimize hides it too
		$("#next_song_box").toggle( !minimized && !pl_on );
	}
	setMinimized( minimized );
	
	function setPlOn(on)
	{
		pl_on=on;
		setCVal( "pl_on", pl_on );
		
		$("#play_list").toggle(pl_on);
		set_icon_on( btn_pllist.find("img"), pl_on );
		setMinimized( minimized );
	}
	setPlOn( pl_on );
	
	var station_select = $("#station_select");
	station_select.on("change", function()
	{		
		cur_station = this.value;
		
		station_select.blur();
		
		setCVal( 'cur_station', cur_station );
		
		//set swirl for station
		all_swirls = parseInt( getCVal('all_swirls_'+cur_station,0) );		
		
		//playlist song keeps playing, only the radio behind it changes
		if( !is_pl_song(cur_song) ){
			stop();
			
			//clear current song (also doesn't set as played for station skipping
			cur_song = null;
			cur_song_a = null;
		}
		
		//drop pending next song from old station
		drop_next_song();
		play_on_load = false;
		btn_next.prop('disabled', false);
		btn_next.removeClass('button_dis');
		
		//load swirls for station
		load_swirls_for_station( 
			load_songs
		)
		
	});
	
	var cur_song_rot_lvl = $("#cur_song_rot_lvl")
	cur_song_rot_lvl.on("change", function()
	{	
		setSongRotLevel( this.value );
		cur_song_rot_lvl.blur();
	});
	
	function setSongRotLevel( newrotlvl, doneFunc )
	{
		//stars only for radio songs
		if( cur_song==null || cur_song.stat_song_id==undefined ){  return;  }
		cur_song_rot_lvl.val(null);
		call_db( 'setSongRotLevel', {
			stat_song_id:cur_song.stat_song_id,
			rot_level:newrotlvl
		}, function(json)
		{
			if( json.error ){  return;  }
			cur_song_rot_lvl.val(newrotlvl);			
			if( doneFunc ){
				doneFunc();
			}
		});		
	}	
	
	
	var global_volume = $("#global_volume");
	global_volume.on("input change", function()
	{
		var newvol = global_volume.val();
		
		setGlobalVol( newvol/100 );
	});
	
	
	function setGlobalVol(val)
	{
		//keep in 0-1
		val = Math.min( 1, Math.max( 0, val ) );
		Howler.volume( val );
		global_volume.val(val*100);
		
		setCVal( 'gvolume', val );
	}
	
	
	var pl_locked = $("#pl_locked");	
	var locked=false;
	var locking=0;
	
	function setLocked(l)
	{
		locked=l
		
		locked ? pl_locked.show() : pl_locked.hide();
	}
	setLocked(0);
	
	//throw away the preloaded radio song, unless it's the one playing
	function drop_next_song()
	{
		next_req++;
		if( next_song_a!=null && next_song_a!=cur_song_a ){  next_song_a.unload();  }
		next_song = null;
		next_song_a = null;
	}
	
	function get_next_song(onLoad)
	{
    //important to get rid of old song;
		if( next_song_a!=null && next_song_a!=cur_song_a ){  next_song_a.unload();  }
    next_song = null;	
    next_song_a = null;	
    
		//newer requests make this one stale
		next_req++;
		var my_req = next_req;
		
		function retry_later()
		{
			setTimeout( function(){
				if( my_req==next_req ){  get_next_song(onLoad);  }
			}, RETRY_MS );
		}
		
		$("#next_song_title").text( "..." );
		$("#next_song_artist").text( "..." );
		var image = document.getElementById('next_cover');
		set_cover_src( image, "./swirls/base/static-dark.gif" );
		
		//next_song = song_list[ Math.floor(Math.random()*song_list.length) ];
		//var song_url = next_song.file;
		getNextSong( function(song)
		{
			//station changed or newer request
			if( my_req!=next_req ){  return;  }
			//db failed, try again
			if( !song ){
				retry_later();
				return;
			}
			
			next_song = song;			
			var song_url = song.file;			
			
			next_song_a = new Howl({
			  src: [encodeURIComponent(song_url)]
			});
			var sound = next_song_a;
			next_song_a.once('loaderror', function()
			{
				//bad file, get another
				sound.unload();
				if( my_req==next_req ){  retry_later();  }
			});
			next_song_a.once('load', function()
			{
				if( my_req!=next_req ){  sound.unload(); return;  }
				
				$("#next_song_title").text( next_song.title );
				$("#next_song_artist").text( next_song.artist );
				
				load_cover_art( next_song, image );
				$("#next_cover").show();
				if(onLoad){
					onLoad();
				}else
				if( play_on_load ){
					play_next();
				}
			});
		
		})
	}
	
	function load_cover_art( song, image )
	{
		if( song==null ){  return;  }
		var url = all_swirls<2 ? cover_url( song ) : null;
		if( url!=null ) {				
			set_cover_src( image, url );				
		}else
		if( all_swirls==1 ){
			set_cover_src( image, "./swirls/base/blank_d.png" );	
		}else{
			no_covers_i = (no_covers_i + 1 + Math.floor(Math.random()*(no_covers_l-1))) % no_covers_l;
			set_cover_src( image, swirl_dir+no_covers[no_covers_i] );
		}				
	}
	
	//song's own art as a blob url, radio or playlist, null if none
	function cover_url( song )
	{
		if( song.cover!=null ){
			return URL.createObjectURL(new Blob( [Uint8Array.from( song.cover.data )], {'type': 'image/jpg'}));
		}
		if( song.tags && song.tags.picture && song.tags.picture.length>0 ){
			var picture = song.tags.picture[0];
			return URL.createObjectURL(new Blob([picture.data], {'type': 'image/' + picture.format}));
		}
		return null;
	}
	
	//set a cover, freeing the old blob url if no cover still shows it
	function set_cover_src( image, url )
	{
		var old = image.src;
		image.src = url;
		if( old.indexOf("blob:")==0 && old!=document.getElementById('cur_cover').src && old!=document.getElementById('next_cover').src ){
			URL.revokeObjectURL( old );
		}
	}

	
	function play_pause()
	{
		if( cur_song_a==null ){
			play_next();			
		}else
		if( !cur_song_a.playing() ){			
			cur_song_a.play();
			btn_play.text("II");
		}else{
			cur_song_a.pause();
			btn_play.text(">");
		}
	}

	//queued songs first, radio when the queue is empty
	function play_next()
	{
		if( is_pl_song(cur_song) || pl_any_ready() ){
			pl_play_next();
		}else{
			play_next_rad();
		}
	}
	
	function play_next_rad()
	{	
		//always stop		
		stop();
		
		// //if the song is still there, make it as played
		// if( cur_song!=null ){
			// markSongPlayed(cur_song);			
		// }
		
		//not loaded yet, play when it is
		if( next_song==null || next_song_a.state()!="loaded" ){
			play_on_load = true;
			btn_next.prop('disabled', true);
			btn_next.addClass('button_dis');
			return;
		}
		play_on_load = false;
		btn_next.prop('disabled', false);
		btn_next.removeClass('button_dis');
		
		cur_song = next_song;		
		cur_song_a = next_song_a;
		
		//mark as played now so get next works right
		if( cur_song!=null ){
			markSongPlayed(cur_song);			
		}
			
		play_song(cur_song_a);
		
		//loadMetaData(song_url);
		var imagen = document.getElementById('next_cover');
		var image = document.getElementById('cur_cover');
		if( imagen.src!=null ) {			
			set_cover_src( image, imagen.src );
		}else{
			set_cover_src( image, "./swirl_1.gif" );
		}
		var last_play_str = "never";
		if( cur_song.last_played>1600000000000){
			last_play_str=new Date(parseInt(cur_song.last_played)).toString();
			last_play_str=moment(next_song.last_played).format("h:mma  MMM D, YYYY");
		}			
		$("#song_play_info").html( "Plays: "+(next_song.tot_plays+1)+" &nbsp;&nbsp; Last: "+last_play_str );
		$("#cur_song_rot_lvl").val( cur_song.rot_level );		
		
		var songt = $("#next_song_title").text();
		var songa = $("#next_song_artist").text();
		
		//hover info, nice rows then full db row for debug
		var ihtml = "<table>"+info_row( "Title", cur_song.title )+info_row( "Artist", cur_song.artist )
			+info_row( "Plays", next_song.tot_plays+1 )+info_row( "Last", last_play_str )
			+info_row( "Stars", $("#cur_song_rot_lvl option:selected").text() )+info_row( "File", cur_song.file )+"</table>";
		ihtml += "<table class='songInfoDbg'>";
		for( var k in cur_song ){
			ihtml += "<tr><td>"+k+"</td><td>"+$("<div>").text( info_text(cur_song[k]) ).html()+"</td></tr>";
		}
		$("#song_info").html( ihtml+"</table>" );
		$("#cur_song_title").text( songt );
		$("#cur_song_artist").text( songa );
		
		//set browser title
		document.title =  "JB: "+songt+" - "+songa;
		
		get_next_song();
	}
	
	function play_song(song)
	{
		cur_song_d = song;
		song_dur = song.duration();
		//song.volume(.2);		
		
		song.on('playerror', function(){			
			play_next();
		});
		song.on('end', function(){			
			play_next();
		});
		song.play();
		
		btn_play.text("II");
	}
	
	
	function stop()
	{
		cur_song_d=null;
		if( cur_song_a!=null ){
			cur_song_a.pause();
			cur_song_a.unload();
			cur_song_a=null;
		}
	}
	
	
	
	function load_songs()
	{
		var for_station = cur_station;
		call_db( 'getSongList', {station:cur_station}, function(json){
			
			//switched station while waiting
			if( for_station!=cur_station ){  return;  }
			song_list=json.songlist;
		
			get_next_song( function(){
				//playlist song playing, radio waits as next
				if( is_pl_song(cur_song) ){  return;  }
				play_next();
			});
		});		 
	}
	
	
	var station_select = $('#station_select');	
	function load_stations(doneFunc)
	{
		call_db( 'getStationList', {}, function(json)
		{
			if( json.error ){  return;  }
			stationlist = json.stationlist;			
			
			htmlStr="";
			//htmlStr+="<option value=''>select station</option>;"
			stationlist.forEach( function(d,i){
				htmlStr+="<option value='"+d.id+"'>"+d.name+"</option>;"
			});
			
			station_select.html(htmlStr);
			
			if(doneFunc){
				doneFunc();
			}
		});		 
	}
	
	function inc_station(val)
	{
		var stationi = station_select.prop('selectedIndex');
		
		stationi = (stationi+val+stationlist.length) % stationlist.length;
			
		//console.log ( JSON.stringify( stationlist[stationi] ) );
		////$('#selectBox :nth-child(4)').prop('selected', true); 
		
		cur_station = stationlist[stationi].id;
		
		station_select.val(cur_station).change();
	}
	
	
	function load_swirls_for_station( doneFunc )
	{	
		//find by id, ids may have gaps
		var station = stationlist.filter( function(s){  return s.id==cur_station;  } )[0];
		swirl_dir =  station ? station.swirl_dir : "./swirls/";
		
		var postData = {
			url: swirl_dir,
			filter: ".gif",
			foldersOnly: false,
			recurse:false
		};		
		
		$.ajax({
		  type: "POST",
		  url: "./getFileList",
		  data: postData,		  
		})
		.done( function ( jstring )		{			
			
			try{
				var json = JSON.parse(jstring);
				var fileList = json.fileList;
				
				no_covers = fileList.map( (v)=> v.fname );
				no_covers_l=no_covers.length;
				no_covers_i=Math.floor(Math.random()*no_covers_l);
				
			}catch( ex ){				
				console.log( "loadDataFileList failed:"+ex);
			}
			
			doneFunc();
		});
	}
	
	function getSongList( params, doneFunc )
	{		
		var postData = {
			url: params.url,
			filter: ".mp3",
			foldersOnly: false,
			recurse:false
		};		
		
		$.ajax({
		  type: "POST",
		  url: "./getSongList",
		  data: postData,		  
		})
		.done( function ( jstring )
		{		
			var songlist=[];
			
			try{
				var json = JSON.parse(jstring);
				songlist = json.songList;
			}catch( ex ){				
				console.log( "loadDataFileList failed:"+ex);
			}
			
			doneFunc( songlist );
		});
	}
	
	
	function getNextSong(doneFunc)
	{
    console.log( "getting next station song--" );
		call_db( 'getNextSong', {station:cur_station}, function(json){
			if( json.song ){
				console.log( "  --> "+json.song.title );
			}
			doneFunc(json.song);
		});			 
	}
	
	function markSongPlayed(song)
	{
		call_db( 'markSongPlayed', {stat_song_id:song.stat_song_id}, function(json)
		{
			
		});		 
	}
	
	
	function call_db( func, data, doneFunc )
	{		
		var postData = {
			func: func,
			data: data			
		};		
		
		$.ajax({
		  type: "POST",
		  url: "./db",
		  data: postData,
      timeout: 10000
		})
		.done( function ( jstring )
		{	
			var json = {};
			try{
				json = JSON.parse(jstring);
			}catch( ex ){				
				console.log( "call_db failed: "+ex);
				json = { error: ""+ex };
			}
			
			doneFunc( json );
		})
    .fail(function(jqXHR, textStatus, errorThrown) {
      console.log("call_db request failed:", textStatus, errorThrown);      
      //always call back so callers don't stall
      doneFunc( { error: textStatus } );
    });;
	}
	
	
	//song postion update
	var loc_bar = $('#loc_bar');
	var song_time = $('#song_time');
  var LOC_BAR_W = 400;
	set_loc_bar();
	function update(){
		//never stop updating
		try{
			set_loc_bar();
		}catch(ex){console.log( "updated erred: "+ex); }
		setTimeout( update,200 );		
	}
	update();	
	
	var pre_load_pick=-1;
	//shift next, this lister goes next over the slot draw
	var forced_next_who=-1;
	
	var lbcolor=Math.random()*360;
	function set_loc_bar()
	{
		if(cur_song_d!=null){
			cur_song_loc = cur_song_d.seek();
		}
		loc_bar.width( cur_song_loc/song_dur * LOC_BAR_W );
		//colors
		lbcolor = (lbcolor+1) % 360;
		loc_bar.css("background", "hsl("+lbcolor+", 60%, 60%)");
		//song time and left, same color as bar
		if( cur_song_d!=null ){
			song_time.text( "[ "+format_time_hms(cur_song_loc)+" | "+format_time_hms(Math.max(0,song_dur-cur_song_loc))+" ]" );
			song_time.css("color", "hsl("+lbcolor+", 60%, 60%)");
		}else{
			song_time.text("");
		}
		
		if( is_pl_song(cur_song) ){
			pl_curtime = pl_playedtime+cur_song_loc;
			pd_update_time();
      
      //if we're near the end of the song and they're more in the play list
      //  pre-pick and load for smoother transitions
      if( pre_load_pick<0 && song_dur - cur_song_loc < 5 ){
        pre_load_pick = pick_next_song();
        var next_song = playlist[pre_load_pick];	
        if( next_song && !next_song.bad ){
          loadSong( next_song.file, function(sound)
          {
            next_song.audio = sound;
          })
        }
      }
		}		
	}
  
  $('#loc_bar_cont').on("click", function(evt) {
    if (cur_song_d) {
      var rect = this.getBoundingClientRect();
      var clickX = evt.clientX - rect.left;
      var barWidth = LOC_BAR_W;
      var seekTime = (clickX / barWidth) * song_dur;
      cur_song_d.seek(seekTime);
      set_loc_bar(); 
    }
  });
	
	
	//rotate images	
	var cur_cover = document.getElementById('cur_cover');
	var cur_cover_t = document.getElementById('cur_cover_1');
	
	
	function rotate_cover()
	{
		//swap
		var ti = cur_cover;
		cur_cover = cur_cover_t;
		cur_cover_t = ti;
		
		//move old up front
		cur_cover_t.parentNode.appendChild(cur_cover_t);
		
		cur_cover.setAttribute("xlink:href", curImage );
	}
	
	
	
	// shortcut keys ///////////
	
	document.addEventListener('keydown', function(evt)
	{
		if( evt.keyCode == 112 ) // F1
		{
			killEvent(evt);
			$("#help_box").show();
			return;
		}
		
		if( evt.keyCode == 76 ) // L
		{
			locking="L";
			return;
		}
		
		if( locking ){
			locking += String.fromCharCode(evt.keyCode);
			return;
		}
		
		if( evt.keyCode == 27 ) // esc
		{
			//streamPause();
		}else
		if( evt.keyCode == 32 ) // space
		{
			killEvent(evt);
			play_pause();
		}else
		if( evt.keyCode == 39 ) // right arrow
		{
			killEvent(evt);
			play_next();
			
		}else
		if( evt.keyCode == 37 ) // left arrow
		{
			killEvent(evt);
			//same as back button, shift too
			btn_back.trigger( $.Event('mousedown',{shiftKey:evt.shiftKey}) );
		}else
		if( evt.keyCode == 38 ) // up arrow
		{
			if(evt.ctrlKey){
				killEvent(evt);
				setGlobalVol( Howler.volume()+.1);	
			}
		}else
		if( evt.keyCode == 40 ) // down arrow
		{
			if( evt.ctrlKey){
				killEvent(evt);
				setGlobalVol( Howler.volume()-.1);	
			}
		}else			
		if( evt.keyCode == 33 ) // pg up
		{
			inc_station(-1);
			evt.preventDefault();
		}else
		if( evt.keyCode == 34 ) // pg dn
		{
			inc_station(+1);
			evt.preventDefault();
		}else
		if( evt.keyCode == 35 ) // end
		{

		}else
		if( evt.keyCode == 83 ) // S
		{
			//switch between real covers and swirls
			all_swirls = (all_swirls+1) % 3;
			setCVal('all_swirls_'+cur_station,all_swirls);			
			load_cover_art( cur_song, cur_cover );
			if( next_song ){
				load_cover_art( next_song, document.getElementById('next_cover') );
			}			
		}else
		if( evt.keyCode == 49 && evt.shiftKey ) // 1
		{
			setSongRotLevel( '1' );
		}else
		if( evt.keyCode == 50 && evt.shiftKey ) // 2
		{
			setSongRotLevel( '2' );
		}else
		if( evt.keyCode == 51 && evt.shiftKey ) // 3
		{
			setSongRotLevel( '3' );
		}else
		if( evt.keyCode == 52 && evt.shiftKey ) // 4
		{
			setSongRotLevel( '4' );
		}else
		if( evt.keyCode == 48 && evt.shiftKey ) // 0
		{
			//also skip
			setSongRotLevel( '0', function(){
				play_next();
			});
		}
	});	
	
	// shortcut keys ///////////
	document.addEventListener('keyup', function(evt)
	{		
		if( evt.keyCode == 112 ) // F1
		{
			$("#help_box").hide();
			return;
		}
		if( evt.keyCode == 76 ){
			if( locking.length>1 ){
				if( locked && locking==locked ){
					setLocked(0);
				}else
				if(!locked){
					setLocked(locking);
				}
			}
			locking=0;
		}		
	});

	
	/////////////////////////////////////////////////
	// play lists ///////////////////////////////////
	
	//play order	
	var PO_LIST = 0;
	var PO_MIX  = 1;
	var PO_RAND = 2;
	
	var playlist = [];
	var played = [];
	
	var pl_playedtime=0;
	var pl_curtime=0;
	var pl_totquetime=0; 
	var pl_tottime=0;
	
	var listers = [];
	for( var i=0;i<4;i++ ){
		listers.push({
			who: i,
			songs_inq:0,
			played:0,
			last_played:0,
			my_slots:0,
			forced_next: -1,
			last_artist: ""
		});
	}
	var ord_listers = listers.slice();
	
	//copy gui to all
	var order_type_proto = $("#order_type_0").html(); 
	for( var i=1;i<4;i++ ){
		$("#order_type_"+i).html(order_type_proto);
	}
	
	//play order is saved in its own array for easy cookie saving
	var play_order_a;
	
	//load playorder
	var playorderjs = getCVal( "play_order_a", null );
	
	if( playorderjs ){
		play_order_a = JSON.parse(playorderjs);
	}else{
		//default to all mixes
		play_order_a = [1,1,1,1];
	}
	
	//no same artist in a row, own cookie too, default on
	var no_artist_a = [1,1,1,1];
	var noartistjs = getCVal( "no_artist_a", null );
	if( noartistjs ){
		no_artist_a = JSON.parse(noartistjs);
	}
	
	for( var i=0; i<4; i++ ){
		var lister = listers[i];
		var otg = $("#order_type_"+i);
		otg.data("i",i);
		lister.order_type_g = otg;		
		lister.order_type_g_po = [];
		lister.order_type_g_po[PO_LIST] = otg.find(".po_list").data("ot",0);
		lister.order_type_g_po[PO_MIX] = otg.find(".po_mix").data("ot",1);
		lister.order_type_g_po[PO_RAND] = otg.find(".po_rand").data("ot",2);		
		
		set_icon_on( lister.order_type_g_po[ play_order_a[i] ], 1 );
		
		lister.artist_g = otg.find(".artist_btn");
		set_icon_on( lister.artist_g, no_artist_a[i] );
	}	
		
	
	$("#song_drops").on("click",".play_ord_btn", function(evt){
		
		var i = $(this).parent().data("i");
		var ot = $(this).data("ot");
		
		var lister = listers[i];
		set_icon_on( lister.order_type_g_po[ play_order_a[i] ], 0);
		play_order_a[i]=ot;
		set_icon_on( lister.order_type_g_po[ play_order_a[i] ], 1 );
		
		setCVal( "play_order_a", JSON.stringify(play_order_a) );		
	});
	
	$("#song_drops").on("click",".artist_btn", function(evt){
		var i = $(this).parent().data("i");
		no_artist_a[i] = no_artist_a[i] ? 0 : 1;
		set_icon_on( listers[i].artist_g, no_artist_a[i] );
		setCVal( "no_artist_a", JSON.stringify(no_artist_a) );
	});
	
	
	$("#playlist_q").on("dblclick","#btn_reload", function(evt){
		// for( var i=0; i< played.length; i++ ){
			// play_list.
		// }
		//current song back to front, played to end
		if( is_pl_song(cur_song) ){
			pl_end_song(cur_song);
			playlist.unshift(cur_song);
			cur_song=null;
		}
		//bad loads dropped, everyone has seen them
		playlist.push(...played.filter( function(s){ return !s.bad; } ));
		played.length=0;
		
		//start counts over
		for( var i=0; i<listers.length; i++ ){
			listers[i].played=0;
			listers[i].last_played=0;
			listers[i].forced_next=-1;
			listers[i].last_artist="";
		}
		pre_load_pick=-1;
		forced_next_who=-1;
		
		cur_song_loc=0;
		pl_curtime=0;
		pl_playedtime=0;
		
		redraw_playlist();
		
		//cuts in over radio
		if( pl_any_ready() ){  pl_play_next();  }
	});
	
	
	function set_icon_on( icon, on )
	{
		icon.css("opacity", on ? 1.0 : .35 );
	}
	
	var dropArea = $(document);
	var dropspots = $(".song_drop");
	var drop_sign = $("#drop_sign");
	dropArea.on("dragenter dragover", function(evt)
	{
		killEvent(evt);
		drop_sign.show();
		
	});
    dropArea.on("dragleave blur", function(evt)
	{
		killEvent(evt);
		drop_sign.hide();
	});
	dropArea.on("drop", function(evt)
	{
		killEvent(evt);		
	});
	
	
	dropspots.on("dragenter dragover", function(evt)
	{
		killEvent(evt);
		
		var me = $(this);
		me.css( "background", me.data("hcolor") );
		
		drop_sign.show();
		
	});
	dropspots.on("dragleave blur drop", function(evt)
	{
		killEvent(evt);
		var me = $(this);
		me.css( "background", me.data("ncolor") );
		
		drop_sign.hide();
	});
	dropspots.on("drop", function(evt)
	{
		killEvent(evt);
		
		if(locked){  return;  }
		
		var who = $(this).data("dropper");
		var dt = evt.originalEvent.dataTransfer;
		
		//song dragged from the library window
		var libpath = lib_drop_path(dt);
		if( libpath!=null ){
			lib_file( libpath, function(file){
				if( file ){  jb_add_file( file, who );  }
			});
			return;
		}
		
		//grab entries now, they die after this handler
		var entries = drop_entries(dt);
		if( entries ){
			collect_drop_files(entries, function(files){
				add_drop_files(files, who);
			});
			return;
		}
		
		//no entries, just the file list
		add_drop_files( dt.files, who );
	});
	
	//entries from a drop, or none if the browser has no entry api
	function drop_entries(dt)
	{
		if( !dt.items || !dt.items.length || !dt.items[0].webkitGetAsEntry ){  return null;  }
		var entries = [];
		for( var i=0; i<dt.items.length; i++ ){
			var entry = dt.items[i].webkitGetAsEntry();
			if( entry ){  entries.push(entry);  }
		}
		return entries.length ? entries : null;
	}
	
	//audio by extension, any case
	function is_audio_name(name)
	{
		var dot, ext;
		if( !name ){  return false;  }
		dot = name.lastIndexOf(".");
		if( dot<0 ){  return false;  }
		ext = name.substring(dot+1).toLowerCase();
		return AUDIO_EXTS.indexOf(ext)>-1;
	}
	
	//walk a drop's entries, files in a stable order
	function collect_drop_files(entries, doneFunc)
	{
		var files = [];
		var ei = 0;
		
		function next_entry()
		{
			if( ei>=entries.length ){
				doneFunc(files);
				return;
			}
			collect_entry(entries[ei], files, function(){
				ei++;
				next_entry();
			});
		}
		next_entry();
	}
	
	function collect_entry(entry, files, doneFunc)
	{
		if( !entry ){
			doneFunc();
			return;
		}
		if( entry.isFile ){
			if( !is_audio_name(entry.name) ){
				doneFunc();
				return;
			}
			entry.file( function(file){
				files.push(file);
				doneFunc();
			}, function(){
				doneFunc();
			});
			return;
		}
		if( entry.isDirectory ){
			collect_dir(entry, files, doneFunc);
			return;
		}
		doneFunc();
	}
	
	function collect_dir(dirEntry, files, doneFunc)
	{
		var reader = dirEntry.createReader();
		var kids = [];
		
		function read_batch()
		{
			reader.readEntries( function(batch){
				var i;
				if( !batch.length ){
					//files first then folders, by name
					kids.sort( function(a,b){
						if( a.isFile!=b.isFile ){  return a.isFile ? -1 : 1;  }
						return a.name.localeCompare(b.name, undefined, {numeric:true});
					});
					i = 0;
					function next_kid()
					{
						if( i>=kids.length ){
							doneFunc();
							return;
						}
						collect_entry(kids[i], files, function(){
							i++;
							next_kid();
						});
					}
					next_kid();
					return;
				}
				for( i=0; i<batch.length; i++ ){
					kids.push(batch[i]);
				}
				read_batch();
			}, function(){
				doneFunc();
			});
		}
		read_batch();
	}
	
	//queue the audio files from a drop
	function add_drop_files(files, who)
	{
		if( locked || !files || !files.length ){  return;  }
		var n = 0;
		for( var i=0; i<files.length; i++ ){
			if( !is_audio_name(files[i].name) ){  continue;  }
			n++;
			pl_add_song( files[i], who );
		}
		if( n>0 ){
			setPlOn( true );
		}
	}
	
	//library hands us a song file for a player
	function jb_add_file( file, who )
	{
		if( locked || !file ){  return false;  }
		//our own copy, so it outlives the library window
		var f = new File( [file], file.name, { type: file.type, lastModified: file.lastModified } );
		add_drop_files( [f], who );
		return true;
	}
	window.jb_add_file = jb_add_file;
	
	//library path from a drop, none for files or other text
	function lib_drop_path(dt)
	{
		if( typeof jdb_resolve!="function" ){  return null;  }
		if( dt.files && dt.files.length>0 ){  return null;  }
		var path = dt.getData( JDB_DRAG_TYPE );
		if( path ){  return path;  }
		var text = dt.getData( "text/plain" );
		if( text && text.indexOf( JDB_DRAG_PREFIX )==0 ){  return text.substring( JDB_DRAG_PREFIX.length );  }
		return null;
	}
	
	//library path to a file, through the library window or the saved folder
	function lib_file( path, doneFunc )
	{
		if( lib_win && !lib_win.closed && lib_win.lib_get_file ){
			lib_win.lib_get_file( path, doneFunc );
			return;
		}
		jdb_load_handle( function(handle)
		{
			if( !handle ){
				console.log( "library: no music folder picked yet" );
				doneFunc(null);
				return;
			}
			//only if already allowed, a drop can't ask
			jdb_check_perm( handle, "read", false, function(ok)
			{
				if( !ok ){
					console.log( "library: music folder not allowed, open the library" );
					doneFunc(null);
					return;
				}
				jdb_resolve( handle, path, doneFunc );
			});
		});
	}
	
	
	var pl_q = $("#playlist_q");
	
	pl_q.on("mouseenter",".pl_song_item", function(evt){
		//$(this).css("color","");
		$(this).find(".plsi").css('visibility','visible');
	});
	pl_q.on("mouseleave",".pl_song_item", function(evt){
		$(this).find(".plsi").css('visibility','hidden');	
	});
	
	//queue song being dragged
	var moving_i=-1;
	var moving_col;
	var moving_moved=false;
	
	//shift-click shouldn't start a text select, drag still can
	pl_q.on("mousedown",".pl_song_item", function(evt){
		if( evt.shiftKey ){  evt.preventDefault(); return;  }
		//plain drag on a queue song moves it, alt drag selects text
		var i = $(this).data("i");
		if( i==undefined || evt.altKey || evt.which!=1 || $(evt.target).hasClass("plsi") ){  return;  }
		evt.preventDefault();
		moving_i = i;
		moving_moved = false;
		moving_col = this.style.color;
		$(this).css("color","#ffff33");
	});
	
	//swap a row at a time toward the row under the mouse
	$(document).on("mousemove", function(evt){
		if( moving_i<0 ){  return;  }
		var rows = pl_q.find(".pl_song_item[data-i]");
		if( rows.length<2 ){  return;  }
		var to = -1;
		for( var j=0; j<rows.length; j++ ){
			var r = $(rows[j]);
			if( evt.pageY < r.offset().top+r.outerHeight() ){  to = j;  break;  }
		}
		//past the bottom, go last
		if( to<0 ){  to = rows.length-1;  }
		if( to==moving_i ){  return;  }
		while( moving_i<to ){  pl_swap( moving_i, moving_i+1 );  moving_i++;  }
		while( moving_i>to ){  pl_swap( moving_i, moving_i-1 );  moving_i--;  }
		moving_moved = true;
		redraw_playlist();
	});
	
	$(document).on("mouseup", function(evt){
		if( moving_i<0 ){  return;  }
		var i = moving_i;
		moving_i=-1;
		//just a click, put color back so hover stays
		if( !moving_moved ){
			pl_q.find(".pl_song_item[data-i="+i+"]").css("color",moving_col);
			return;
		}
		redraw_playlist();
	});
	
	pl_q.on("click",".pl_song_item", function(evt){
		if( evt.shiftKey ){
			var i = $(this).find(".plsi_x").data("i");
			//ignore songs still loading
			if( i==undefined || pl_song_ready(playlist[i]) ){
				pl_play_next( i );
			}
		}		
	});
	
	pl_q.on("click",".plsi_x", function(evt){
		var i = $(this).data("i");
		var del_song = playlist[i];
		var lstr = listers[del_song.who];
		if( lstr.forced_next==i){
			lstr.forced_next=-1;
		}
		playlist.splice( i, 1 )[0];
		if( del_song.audio!=null ){
			del_song.audio.unload();
		}
		adjust_fnexts(i);
		redraw_playlist();
	});
	
	pl_q.on("click",".plsi_next", function(evt){
		var i = $(this).data("i");
		var song = playlist[i];
		var lstr = listers[song.who];
		//shift, next over everyone, not play now
		if( evt.shiftKey ){
			evt.stopPropagation();
			if( forced_next_who==song.who && lstr.forced_next==i ){
				forced_next_who=-1;
				lstr.forced_next=-1;
			}else{
				//takes it from anyone else
				if( forced_next_who>-1 ){  listers[forced_next_who].forced_next=-1;  }
				forced_next_who=song.who;
				lstr.forced_next=i;
			}
			pre_load_pick=-1;
			redraw_playlist();
			return;
		}
		//normal click drops the override
		if( forced_next_who==song.who ){  forced_next_who=-1;  }
		if( lstr.forced_next==i){
			lstr.forced_next=-1;
		}else{
			lstr.forced_next=i;
		}
		
		redraw_playlist();
	});
	
	function pl_add_song(file,who)
	{
		var song = {
			file: file,
			filename: file.name,
			tags: null,
			audio: null,
			who: who,
			duration:-1
		}
		var myi = playlist.push(song) -1;
		redraw_playlist();
		
		getMetaData( file, function( err, tags )
		{
			//no tags, play with filename
			if( err || !tags ){
				console.log(err);
				tags = { title: "", artist: "", picture: [] };
			}
			
			//override blanks
			if( !tags.title || tags.title==""){
				tags.title = file.name;
			}
			
			song.tags=tags;
			
			redraw_playlist();
			//cuts in over radio or idle
			if( !is_pl_song(cur_song) && pl_any_ready() ){				
				pl_play_next();
			}
		});
		
		//full file load waits for a slot
		load_pending.push(song);
		pl_start_loads();
	}
	
	//songs waiting for a load slot
	var load_pending = [];
	var loads_inflight = 0;
	
	//next waiting song, front of the queue first
	function pl_next_to_load()
	{
		var i, song;
		//drop songs no longer in the queue
		for( i=load_pending.length-1; i>=0; i-- ){
			song = load_pending[i];
			if( playlist.indexOf(song)<0 || song.duration>0 || song.bad ){
				load_pending.splice(i,1);
			}
		}
		for( i=0; i<playlist.length; i++ ){
			if( load_pending.indexOf(playlist[i])>-1 ){
				return playlist[i];
			}
		}
		return null;
	}
	
	//load one song, then free the slot
	function pl_load_one(song)
	{
		loadSong( song.file,
			function(sound){
				//song.audio = sound;
				song.duration = sound.duration();
				//unload until needed
				sound.unload();
				
				loads_inflight--;
				redraw_playlist();
				//cuts in over radio or idle, only if still playable
				if( !is_pl_song(cur_song) && pl_any_ready() ){							
					pl_play_next();
				}
				pl_start_loads();
			},
			function(id,err){
				console.log(err);
				//keep it shown, thrown away when picked
				song.bad = true;
				loads_inflight--;
				redraw_playlist();
				pl_start_loads();
			}
		);
	}
	
	//start waiting loads up to the max
	function pl_start_loads()
	{
		while( loads_inflight<MAX_LOADS ){
			var song = pl_next_to_load();
			if( !song ){  return;  }
			//take it off the wait list
			load_pending.splice( load_pending.indexOf(song), 1 );
			loads_inflight++;
			pl_load_one(song);
		}
	}
	
	//bump down the forced_nexts when a song is removed
	function adjust_fnexts(remi)
	{		
		for( var i=0; i<listers.length; i++ ){
			
			if( listers[i].forced_next==remi ){
				listers[i].forced_next=-1;
			}else
			if( listers[i].forced_next>remi ){
				listers[i].forced_next--;
			}
		}
		
		//also update pre_load_pick if needed
		if( pre_load_pick==remi ){
			pre_load_pick=-1;
		}
		if( pre_load_pick>remi ){
			pre_load_pick--;
		}
		
		//and a song being dragged
		if( moving_i==remi ){
			moving_i=-1;
		}
		if( moving_i>remi ){
			moving_i--;
		}
	}
	
	//swap two queue songs, nexts follow their songs
	function pl_swap( a, b )
	{
		var t = playlist[a];
		playlist[a] = playlist[b];
		playlist[b] = t;
		for( var i=0; i<listers.length; i++ ){
			if( listers[i].forced_next==a ){  listers[i].forced_next=b;  }else
			if( listers[i].forced_next==b ){  listers[i].forced_next=a;  }
		}
		if( pre_load_pick==a ){  pre_load_pick=b;  }else
		if( pre_load_pick==b ){  pre_load_pick=a;  }
	}
	
	function pl_end_song(song)
	{
		stop();
	
		//move over played time
		pl_playedtime=pl_curtime;
		
		if(song){
			song.audio=null;	
		}
	}
		
	//done loading, or failed and can be thrown away
	function pl_song_ready(song)
	{
		return song.bad || ( song.tags!=null && song.duration>0 );
	}
	
	//any good queue song ready, without picking
	function pl_any_ready()
	{
		for( var i=0; i<playlist.length; i++ ){
			if( !playlist[i].bad && pl_song_ready(playlist[i]) ){  return true;  }
		}
		return false;
	}
	
	//playlist songs have a player, radio songs don't
	function is_pl_song(s)
	{
		return s!=null && s.who!=undefined;
	}
		
	function pl_play_next(forcedi)
	{	
		var nexti;
		
		if( forcedi != undefined ){
			nexti = forcedi;
		}else{
		if( pre_load_pick>-1 ){
			nexti = pre_load_pick;
			pre_load_pick=-1;
		}else			
			nexti = pick_next_song();
		}			
		
		//current goes to history first, so failures land after it
		if( is_pl_song(cur_song) ){
			played.push( cur_song );
		}
		
		//load failures go to history when their turn comes
		while( nexti>-1 && playlist[nexti].bad ){
			played.push( playlist[nexti] );
			playlist.splice(nexti,1);
			adjust_fnexts(nexti);
			nexti = pick_next_song();
		}
		
		if( nexti>-1 )
		{	
			// random grabs one that isn't loaded yet
			// while( playlist[nexti].duration<=0 || playlist[nexti].tags==null ){
				// nexti = (nexti+1) % playlist.length;				
			// }
			
			var last_song = cur_song;
			
			//pull new song
			cur_song = playlist[nexti];			
			playlist.splice(nexti,1);
			
			adjust_fnexts(nexti);
				
			listers[cur_song.who].played++;
			listers[cur_song.who].last_artist = song_artist(cur_song);
			
			//radio waiting to start is off
			play_on_load = false;
			
			if( cur_song.audio ){
				pl_end_song(last_song);
				cur_song_a = cur_song.audio;
				play_song( cur_song_a );			
				update_playing_info( cur_song.tags );
			}else{
				btn_next.prop('disabled', true);
				btn_next.addClass('button_dis');
				
				loadSong( cur_song.file, function(sound)
				{
					pl_end_song(last_song);					
					cur_song.audio = sound;
					cur_song_a = sound;
					
					play_song( cur_song_a );			
					update_playing_info( cur_song.tags );
					
					btn_next.prop('disabled', false);
					btn_next.removeClass('button_dis');
				},
				function(){
					//failed at play, skip on like the next button
					pl_end_song(last_song);
					cur_song.bad = true;
					btn_next.prop('disabled', false);
					btn_next.removeClass('button_dis');
					pl_play_next();
				})
			}
			
			
		}else{
			//nothing ready, finish current, radio takes over
			pl_end_song(cur_song);
			cur_song=null;
			play_next_rad();
		}
		
		redraw_playlist();
	}
	
	var last_slot=-1;
	
	function pick_next_song()
	{
		//count songs ready to play for each lister
		var tot_ready=0;
		for( var i=0; i<listers.length; i++ ){
			listers[i].songs_rdy=0;
		}
		for( var i=0; i<playlist.length; i++ ){
			if( pl_song_ready(playlist[i]) ){
				listers[playlist[i].who].songs_rdy++;
				tot_ready++;
			}
		}
		
		//if none ready return none
		if( tot_ready==0 ){  return -1;  }
		
		//reorder listers by current played
		ord_listers.sort( (a,b)=>{ return a.played-b.played; } );
		
		var most_plays = ord_listers[ord_listers.length-1].played;
		var last_lister = is_pl_song(cur_song) ? cur_song.who : -1;
		
		//assign slots
		var tot_slots=0;		
		for( var i=0; i<ord_listers.length; i++ )
		{
			var l=ord_listers[i];
			var my_slots=0;
			//only get slots if have songs in que and not last lister
			if( l.songs_rdy>0 && l.who!=last_lister )
			{				
				//give slots for how long its been since we played last				
				my_slots += l.last_played;
				
				//give an extra slot if you are behind in plays
				if( most_plays>l.played ){
					my_slots += 1;
				}
				
			}
			
			l.my_slots=my_slots;
			tot_slots+=my_slots;			
			
			l.np_slots = tot_slots;			
		}
		
		var next_who;
		
		//forced next who skips the draw, once their song is ready
		if( forced_next_who>-1 && listers[forced_next_who].forced_next<0 ){  forced_next_who=-1;  }
		if( forced_next_who>-1 && pl_song_ready(playlist[listers[forced_next_who].forced_next]) ){
			next_who = forced_next_who;
			forced_next_who=-1;
		}
		
		if( next_who==undefined )
		{
			//now draw from slots
			last_slot = Math.floor( Math.random()*tot_slots );
			
			//find who
			for( var i=0; i<ord_listers.length; i++ )
			{
				var l=ord_listers[i];
				
				if( last_slot<l.np_slots ){
					next_who = l.who;
					break;
				}
			}
		}
		
		//if no one picked, it's probably cuz there's only one who, so just use who of first playlest song
		if(next_who==undefined){
			next_who=playlist.filter( pl_song_ready )[0].who;
		}
		
		//keep track of last played
		for( var i=0; i<ord_listers.length; i++ )
		{
			var l=ord_listers[i];
			
			//if next who, reset to 0
			if( l.who==next_who ){
				l.last_played = 0;
			}else
			//if not and have some in que, then add 1		
			//if( l.songs_inq>0 )
				//alwys increment, so when new guy drops in he plays next
			{
				l.last_played += 1;				
			}	
		}

		//check for forced song first
		var fni = listers[next_who].forced_next;
		if( fni>-1 && pl_song_ready(playlist[fni]) )
		{
			listers[next_who].forced_next = -1;
			return fni;
		}	
	
		//now pick a song from who's sublist
		var whosongs = playlist.filter( (s,i)=>{ s.oi=i; return s.who==next_who && pl_song_ready(s); } );
		
		//no same artist as playing or their last, unless that's all they have
		if( no_artist_a[next_who] ){
			var cur_a = song_artist(cur_song);
			var last_a = listers[next_who].last_artist;
			var difsongs = whosongs.filter( function(s){  var a = song_artist(s);  return a=="" || ( a!=cur_a && a!=last_a );  } );
			if( difsongs.length>0 ){  whosongs = difsongs;  }
		}
		
		var ot = play_order_a[next_who];
		var whichi=0;
		
		
		if( ot==PO_MIX ){
			//random, but more likely front of list by sqared curve
			whichi = Math.floor( Math.pow( Math.random() * Math.pow(whosongs.length,3), (1/3) ) );
			whichi = whosongs.length-1-whichi;
		}else
		if( ot==PO_RAND ){
			whichi = Math.floor( Math.random() * whosongs.length );
		}
		//PO_LIST, just play 0 which is next in list
		
		//debug show whcih song we picked
		var whichsongh="";
		for(var si=0; si<whosongs.length; si++ ){
			whichsongh += si==whichi ? (si+1) : "i";
		}
		$("#last_slot").html( whichsongh );	
		
		return whosongs[whichi].oi;
	}
	
	
	//artist for same artist checks, blank never matches
	function song_artist(s)
	{
		if( !s || !s.tags || !s.tags.artist ){  return "";  }
		return String(s.tags.artist).toLowerCase().trim();
	}
	
	var song_cols = [ "#dd9999", "#99cc99", "#9999ff", "#dd99ee" ]
	
	function redraw_playlist()
	{
		pdiv = $("#playlist_q");
		
		htmls="";
		
		pl_totquetime=0;
		pl_tottime=0;
		
	
		for( var i=0;i<listers.length;i++ ){
			listers[i].songs_inq=0;
		}
	
		
		if( is_pl_song(cur_song) ){		
			//htmls += song_item_html( cur_song, -1, "#ffff99");
			htmls += song_item_html( cur_song, -1, song_cols[cur_song.who], "#222222" );
			pl_tottime+=cur_song.duration;
		}
		
		htmls += "<div style='height:10px;'></div>";
		for( var i=0; i< playlist.length; i++ ){
			song = playlist[i];
			htmls += song_item_html(song, i, song.duration>0 ? song_cols[song.who] : "#888888", i%2==0 ? "#222222" : 0 );
			if( song.duration>0 ){  pl_totquetime+=song.duration;  }
			listers[song.who].songs_inq++;
		}
		
		pl_tottime+=pl_totquetime;
		htmls += "<div style='height:20px;'></div>";
		for( var i=0; i< played.length; i++ ){
			song =  played[i];
			htmls += song_item_html( song, -1, "#888888");
			if( song.duration>0 ){  pl_tottime+=song.duration;  }
		}
		if( played.length>0 ){
			htmls += "<div id='btn_reload' class='button backb reloadb no_select' style='margin-left:100px;' >reload</div>";
		}
		pdiv.html(htmls);
		
		
		for( var i=0;i<listers.length;i++ ){
			var l=listers[i];
			html="";
			if( l.songs_inq+l.played>0 ){
				html="Q "+l.songs_inq+"<br/>P "+l.played;
			}				
			$("#song_drop_"+i).html( html );
			var slotsh = "";
			if( l.my_slots>0){
				//$("#my_slots_"+i).html( ""+(l.np_slots-l.my_slots)+ "|".repeat(l.my_slots)+(l.np_slots-1) );
				
				for(var si=0; si<l.my_slots; si++ ){
					slotsh += (l.np_slots-l.my_slots+si==last_slot) ? "I" : "i";
				}
			}else{
				slotsh = "";
			}
			$("#my_slots_"+i).html( slotsh );
		}		
			 
	}
	
	pl_time = $("#pl_time");
	function pd_update_time()
	{
		var tleft = pl_totquetime;
		if( is_pl_song(cur_song) ){
			tleft += cur_song.duration-cur_song_loc;
		}
		
		pl_time.html( "[ "+format_time_hms(pl_curtime)+" | "+format_time_hm(tleft)+" | "+format_time_hm(pl_tottime)+" ]" );
	}
	
	function format_time_hm(t)
	{
		ts="";
		
		var h = Math.floor(t/3600);
		if( h>0 ){			
			ts += h +"h";
			t %= 3600;
		}		
		
		var m = Math.floor(t/60);
		ts += ((h>0 && m<10) ? "0" : "")+m+"m";
		
		return ts;		
	}
	
	function format_time_hms(t)
	{
		ts="";
		
		var h = Math.floor(t/3600);
		if( h>0 ){			
			ts += h +":";
			t %= 3600;
		}		
		
		var m = Math.floor(t/60);
		ts += ((h>0 && m<10) ? "0" : "")+m+":";
		
		t %= 60;
		s = Math.floor(t);
		ts += (s<10 ? "0" : "")+s;
		
		return ts;		
	}

	function song_item_html( song, i, color, bgcolor,  )
	{	
		//dragged song shows yellow
		if( i>=0 && i==moving_i ){  color="#ffff33";  }
		var htmls="<div class='pl_song_item'"+(i>=0 ? " data-i="+i : "")+" style='font-size:16px;color:"+color+";"
				   + (bgcolor ? " background:"+bgcolor+";" : "")
				   +"'>";
		
		if(song.bad){
			htmls += "<span style='color:#ff6666;'>load failed</span> <span style='font-size:12px;'>"+song.filename+"</span>";
		}else
		if(song.tags==null){
			htmls += "...<span style='font-size:12px;'>"+song.filename+"</span>";
		}else{
			//tags in, file not loaded yet
			if( !(song.duration>0) ){  htmls += "...";  }
			htmls += song.tags.title+" - <span style='font-size:14px;'>"+song.tags.artist+"</span>";
		}
		
		if(i>=0){
			var fn = listers[song.who].forced_next==i;
			htmls += "&nbsp;"
			if(fn){ 
				htmls += "<span style='color:#ffff33;font-size:14px;'>"+(forced_next_who==song.who ? "**" : "*")+"</span>";
			}
			htmls += "<span class='plsi plsi_next' data-i="+i+" style='color:"+(fn?"#ffff33":"#888833")+";font-size:12px;visibility:hidden;'> ¡next! </span>";
			
			htmls += "&nbsp;<span class='plsi plsi_x' data-i="+i+" style='color:#ff9999;font-size:16px;visibility:hidden;'> X </span>";
		}
		
		htmls += "</div>";
		
		return htmls;
	}


	function loadMetaData(url)
	{
		var xhr = new XMLHttpRequest();
		xhr.responseType = "arraybuffer";
		xhr.open("get", url, true);
		xhr.crossOrigin = null;
		xhr.onload = function(e) {
			showMetaData(e.target.response);
		}
		xhr.send();
	}
	

	function getMetaData( data, callback )
	{
		jsmediatags.read( data, {
			onSuccess: function(res){
				var t = res.tags;
				//same shape musicmetadata gave, plus everything read
				var pics = [];
				if( t.picture ){
					pics.push({ data: new Uint8Array(t.picture.data), format: t.picture.format.replace("image/","") });
				}
				callback( null, { title: t.title || "", artist: t.artist || "", year: t.year || "", picture: pics, raw: t } );
			},
			onError: function(err){
				callback( err );
			}
		});
	}
	
	//one info box row, skipped when empty
	function info_row( label, val )
	{
		if( val==null || val==="" ){  return "";  }
		return "<tr><td>"+label+"</td><td>"+$("<div>").text( val ).html()+"</td></tr>";
	}
	
	//one readable line for a db field or tag frame
	function info_text( v )
	{
		if( v==null ){  return "";  }
		if( typeof v!="object" ){  return String(v);  }
		//tag frame wraps its value
		if( v.id!=undefined && v.data!=undefined ){  v = v.data;  }
		if( typeof v!="object" ){  return String(v);  }
		//pictures and blobs, just size
		var bytes = v.data!=undefined ? v.data : v;
		if( bytes.length!=undefined && typeof bytes[0]=="number" ){
			return (v.format ? v.format+", " : "")+bytes.length+" bytes";
		}
		//comments and lyrics
		if( v.text!=undefined ){  return (v.short_description ? v.short_description+": " : "")+v.text;  }
		//user text frames
		if( v.user_description!=undefined ){  return v.user_description+": "+v.data;  }
		return JSON.stringify(v);
	}
	
	function loadSong( file, onload, onloaderror )
	{
		var reader = new FileReader();
	    reader.readAsDataURL( file );
	    reader.onload = function() {
			var sound = new Howl({
				src: [reader.result],
				onloaderror: function(id,err){
					console.log(err);
					if( onloaderror){  onloaderror();  }
				},
				onload: function(){
					if( onload){  onload(sound);  }
				}
							
			});
		};
		reader.onerror = function (error) {
			console.log(error);
			if(onloaderror){  onloaderror();  }
	    };
	}
		
	function showMetaData( data )
	{
		cur_cover.src="./swirls/base/static-dark.gif";
		
		getMetaData( data, function (err, result) {
			if(err){  console.log(err); return;  }
			console.log(result);			
			
		});
    }
	
	function update_playing_info( song )
	{
		var image = document.getElementById('cur_cover');
		
		//same cover modes as radio
		load_cover_art( cur_song, image );
		$("#cur_song_info").text( song.artist + " - " +song.title );
		//div.innerText = JSON.stringify(song, undefined, 2);
		
		$("#song_play_info").html( "Plays: -- &nbsp;&nbsp; Last: --" );
		$("#cur_song_rot_lvl").val( 0 );			
		
		//hover info, nice rows then every tag read
		var ihtml = "<table>"+info_row( "Title", song.title )+info_row( "Artist", song.artist )
			+info_row( "Length", format_time_hms(cur_song.duration) )+info_row( "File", cur_song.filename )
			+"<tr><td>Who</td><td style='color:"+song_cols[cur_song.who]+";'>player "+(cur_song.who+1)+"</td></tr></table>";
		ihtml += "<table class='songInfoDbg'>";
		//raw frames, or the plain fields if the format has no frames
		var frames = 0;
		for( var k in song.raw ){
			var f = song.raw[k];
			if( f && f.id!=undefined ){
				ihtml += "<tr><td>"+k+(f.description ? " "+f.description : "")+"</td><td>"+$("<div>").text( info_text(f) ).html()+"</td></tr>";
				frames++;
			}
		}
		if( frames==0 ){
			for( var k in song.raw ){
				ihtml += "<tr><td>"+k+"</td><td>"+$("<div>").text( info_text(song.raw[k]) ).html()+"</td></tr>";
			}
		}
		$("#song_info").html( ihtml+"</table>" );
		$("#cur_song_title").text( song.title );
		$("#cur_song_artist").html( song.artist +
      ((song.year && song.year!="") ? ("<span class=\"songYear\">  ("+song.year+")</span>") : "")
    );

		//set browser title
		document.title =  "JB: "+song.title+" - "+song.artist;		
	}
	
	
	//song info box on title hover
	$("#cur_song_title").on("mouseenter", function(){
		if( $("#song_info").html()!="" ){  $("#song_info").show();  }
	});
	$("#cur_song_title").on("mouseleave", function(){
		$("#song_info").hide();
	});
	
	// startup /////////////////////////////////////////
	
	//warn before losing playlist songs, queued or in history
	if( !indev ){
		$(window).bind('beforeunload', function(){
			if( playlist.length>0 || played.length>0 || is_pl_song(cur_song) ){
				return event.returnValue = "WARNING: Leaving will end and lose your playlist!";
			}
		});
	}
	
	var curval = parseFloat(getCVal( 'gvolume', .2 ));
	setGlobalVol(curval);
	
	load_stations( function()
	{
		//url param first
		var cur_station = getUrlParam('station',null);
		//then check cookie
		if(cur_station==null){
			cur_station = getCVal( 'cur_station', 1 );
		}
		//old playlist or missing station, use first
		if( stationlist.length>0 && stationlist.filter( function(s){  return s.id==cur_station;  } ).length==0 ){
			cur_station = stationlist[0].id;
		}
		
		//switch to station
		station_select.val(cur_station).change();		
	});
}


function killEvent(e) {
	e.stopPropagation();
	e.preventDefault();
}


function getUrlParam( name, defVal )
{
	var results = new RegExp('[\?&]' + name + '=([^&#]*)').exec(window.location.href);
	if(results==null){
		return defVal;
	}
	else{
		return decodeURIComponent( results[1] || null );
	}
}

// cookie vals //////////////////////////////
function getCVal( key, defval )
{
	var cval = $.cookie(key);
	
	if( cval == null ){
		cval=defval;
	}
	
	return cval;
}

function setCVal( key, val )
{
	$.cookie( key, val, { expires: 3650 } );	
}




