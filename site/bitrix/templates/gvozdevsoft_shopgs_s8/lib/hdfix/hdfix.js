jQuery(document).ready(function() {
	jQuery(window).scroll(function(){
		if (jQuery(this).scrollTop() > 180) {
			jQuery('.head_slide').css("top","0px");
		} else {
			jQuery('.head_slide').css("top","-50px");
		}
	});
});