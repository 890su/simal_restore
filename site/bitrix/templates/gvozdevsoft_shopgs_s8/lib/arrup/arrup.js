jQuery(document).ready(function() {
	jQuery("body").append('<a id="arrup"><i class="fa fa-angle-up"></i></a>');
	
	jQuery(window).scroll(function(){
		if (jQuery(this).scrollTop() > 200) {
			jQuery('#arrup').addClass("arvis");
		} else {
			jQuery('#arrup').removeClass("arvis");
		}
	});
	 
	jQuery('#arrup').click(function(){
		jQuery("html, body").animate({ scrollTop: 0 }, 800);
		return false;
	});
});