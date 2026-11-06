var minwidth=769;
var flgmini=false;
window.onresize = CheckLis;

jQuery(document).ready(function() {
	var lastli = "<li id='fllast'><a>. . .</a><ul></ul></li>";
	jQuery("#flvmenu > ul").append(lastli);
	jQuery("#flvmenu").prepend("<div class='minmenu'><i class='fa fa-bars'></i><a>МЕНЮ</a></div>");
	jQuery("#flvmenu > ul li ul").before("<a class='flarr'></a>");
	//scrwdth=scrlbarWidth();
	CheckLis();
	Setmini();
});

function CheckLis() {
	var navw;
	var lastli;
	var allw=0;
	var navItems;
	var wdoc=window.innerWidth;

	if(wdoc > minwidth) {
		lastli = jQuery("#fllast").width();
		var fllastlng = jQuery("#fllast > ul > li").length;
		if(fllastlng == 0) lastli = 0;
		navw = jQuery("#flvmenu").width();
		jQuery('#flvmenu > ul > li').last().before(jQuery("#fllast > ul > li"));
		jQuery("#flvmenu > ul > li:not(#fllast)").each(function() { allw += this.clientWidth; });
		navItems = jQuery('#flvmenu > ul > li:not(#fllast)');
		if(fllastlng == 1 && allw <= navw) lastli = 0;

		while((allw+lastli) > navw) {
			allw -= navItems.last().width();
			navItems.last().prependTo('#fllast > ul');
			navItems.splice(-1,1);
			if(fllastlng == 0) lastli = jQuery("#fllast").width();
		}
		jQuery("#fllast").css("display","none");
		if(jQuery("#fllast > ul > li").length > 0) jQuery("#fllast").css("display","inline-block");
		jQuery(".flarr").html("");
		jQuery('#flvmenu > ul > li ul').css("height","auto");
		jQuery("#flvmenu > ul").css("display","block");
		SetAlignBl(wdoc);
		if(flgmini) {flgmini = false; CheckLis();}
	} else {
		if(!flgmini) {
			jQuery('#flvmenu > ul > li').last().before(jQuery("#fllast > ul > li"));
			jQuery("#fllast").css("display","none");
			jQuery('#flvmenu > ul > li ul').css("height","0").css("right","auto").css("left","auto");
			jQuery(".flarr").html("<i class='fa fa-plus'></i>");
			jQuery("#flvmenu > ul").css("display","none");
			flgmini = true;
		}
	}
}

function Setmini() {
	jQuery(".flarr").click(function() {
		var wdoc=document.documentElement.clientWidth;
		if(minwidth > wdoc) {
			var par = this.parentElement;
			var chldul = par.getElementsByTagName('ul')[0];
			var chght = chldul.style.height; 
			if(chght == "0px") {
				jQuery(this).html("<i class='fa fa-minus'></i>");
				chldul.style.height = "auto";
			} else {
				jQuery(this).html("<i class='fa fa-plus'></i>");
				chldul.style.height = "0px";
			}
		}
	});
	jQuery(".minmenu").click(function() {
		var disp = jQuery("#flvmenu > ul").css("display");
		if(disp == "block") jQuery("#flvmenu > ul").css("display","none");
			else jQuery("#flvmenu > ul").css("display","block");
	});
}
function SetAlignBl(wdoc){
	jQuery("#flvmenu > ul > li > ul").each(
		function(){
			jQuery(this).css("left","0");
			jQuery(this).css("right","auto");
			var chldel = this.firstElementChild;
			var chlwth=0;
			if(chldel != null) chlwth = jQuery(chldel).width();
			var setel = getLeftSet(this) + chlwth;
			if(setel > wdoc) {
				jQuery(this).css("left","auto");
				jQuery(this).css("right","0");
			}
	});
	jQuery("#flvmenu > ul > li > ul > li > ul").each(
		function(){
			jQuery(this).css("left","100%");
			jQuery(this).css("right","auto");
			var chldel = this.firstElementChild;
			var chlwth=0;
			if(chldel != null) chlwth = jQuery(chldel).width();
			var setel = getLeftSet(this) + jQuery(this.parentElement).width() + chlwth;
			if(setel > wdoc) jQuery(this).css("left","-100%");
	});
}
function getLeftSet(elem) {
    var left=0;
    while(elem) {
        left = left + parseFloat(elem.offsetLeft);
        elem = elem.parentElement;
    }
	return Math.round(left);
}