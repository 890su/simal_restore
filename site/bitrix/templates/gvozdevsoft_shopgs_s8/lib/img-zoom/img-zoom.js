$(document).ready(function(){
	$(".img_zoom a").append("<span></span>");
	$(".img_zoom a").hover(function(){
		$(this).children("span").fadeIn(0);
		},function(){
		$(this).children("span").fadeOut(0);
	});
});			