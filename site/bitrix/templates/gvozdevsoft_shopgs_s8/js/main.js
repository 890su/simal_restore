$(document).ready(function(){
	if (!$.fn.justifiedGallery) {
		$.fn.justifiedGallery = function () { return this; };
	}

	$(".mygallery").justifiedGallery({
		rowHeight : 150,
		lastRow : 'nojustify',
		captions : false,
		border : 0,
		margins : 7
	});

	$(".mygallery2").justifiedGallery({
		rowHeight : 200,
		lastRow : 'nojustify',
		captions : false,
		border : 0,
		margins : 7
	});

	$(".mygallery-catalog").justifiedGallery({
		rowHeight : 70,
		lastRow : 'nojustify',
		captions : false,
		border : 0,
		margins : 7
	});

	var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	//Slider main page
	$(".header-slider.owl-carousel").owlCarousel({
		items:1,
		loop:true,
		margin:0,
		nav:false,
		autoplay:!reduceMotion,
		autoplayTimeout:6000,
		smartSpeed:750,
		autoplayHoverPause:true
	});

	//Slider section main page
	$(".section-slider").owlCarousel({
		items:4,
		loop:true,
		margin:30,
		nav:true,
		dots: false,
		autoplay:false,
		smartSpeed:750,
		autoplayHoverPause:false,
		responsive:{
			0:{
				items:1
			},
			768:{
				items:2
			},
			992:{
				items:4
			} 
		}
	});

	//Slider section main page
	$(".section-slider2").owlCarousel({
		items:3,
		loop:true,
		margin:30,
		nav:true,
		dots: false,
		autoplay:false,
		smartSpeed:750,
		autoplayHoverPause:false,
		responsive:{
			0:{
				items:1
			},
			768:{
				items:2
			},
			992:{
				items:3
			} 
		}
	});

	//Slider section main page partners
	$(".section-slider-partners").owlCarousel({
		items:6,
		loop:true,
		margin:30,
		nav:false,
		dots: false,
		autoplay:!reduceMotion,
		smartSpeed:750,
		autoplayHoverPause:false,
		responsive:{
			0:{
				items:2
			},
			768:{
				items:3
			},
			992:{
				items:5
			} 
		}
	});

	$(".section-slider .owl-next, .section-slider2 .owl-next").html("<i class='fa fa-angle-right nextarr' aria-hidden='true'></i>");
	$(".section-slider .owl-prev, .section-slider2 .owl-prev").html("<i class='fa fa-angle-left prevarr' aria-hidden='true'></i>");

	// Fixed - sidebar
	$('#sidebar_fixed').sticky({topSpacing:70});

	// Action - sidebar
	$(".sidebar-action").owlCarousel({
		items:1,
		loop:true,
		margin:0,
		nav:true,
		dots: false,
		autoplay:!reduceMotion,
		smartSpeed:750,
		autoplayHoverPause:false,
	});

	// Review, portfolio - sidebar
	$(".sidebar-review, .sidebar-portfolio").owlCarousel({
		items:1,
		loop:true,
		margin:0,
		nav:true,
		dots: false,
		autoplay:false,
		smartSpeed:750,
		autoplayHoverPause:false,
	});

	$("#sidebar .owl-next").html("<i class='fa fa-arrow-circle-right nextarr' aria-hidden='true'></i>");
	$("#sidebar .owl-prev").html("<i class='fa fa-arrow-circle-left prevarr' aria-hidden='true'></i>");

	// Taby - calc
	$(".tabs").lightTabs();
	
	//Maska nomer phone
	$(".inputmask").inputmask(typeof window.inputMaskPattern !== 'undefined'?window.inputMaskPattern:"+7 (999) 999-99-99");

	// Spaces in a prices
	$(".pricespace").each(function(){
		var price = $(this).html();
		var parts = (price + '').split('.');
		var main = parts[0];
		var len = main.length;
		var pricetxt = '';
		var i = len - 1;
		while(i >= 0) {
			pricetxt = main.charAt(i) + pricetxt;
			if ((len - i) % 3 === 0 && i > 0) {
				pricetxt = ' ' + pricetxt;
			}
			--i;
		}
		if (parts.length > 1) { pricetxt += '.' + parts[1]; }
		$(this).html(pricetxt);
	});

});


if (window.innerWidth > 768){
document.addEventListener('DOMContentLoaded', function() {
    const menu = document.getElementById('horizontal-multilevel-menu');
    const ARROW_HEIGHT = 30;
    const SCROLL_INTERVAL = 50;
    const SCROLL_STEP = 65;
    
    const dropdownData = new WeakMap();

    function createArrows(dropdown) {
        if (dropdownData.has(dropdown)) {
            return dropdownData.get(dropdown);
        }
        
        const arrowUp = document.createElement('div');
        arrowUp.className = 'submenu-arrow submenu-arrow-up';
        arrowUp.innerHTML = '<i class="fa fa-chevron-up"></i>';
        arrowUp.style.cssText = `
            display: none;
            position: fixed;
            left: 0;
            width: 100%;
            height: ${ARROW_HEIGHT}px;
            background: linear-gradient(to bottom, rgba(255,255,255,0.95), rgba(255,255,255,0.85));
            align-items: center;
            justify-content: center;
            z-index: 10001;
            cursor: pointer;
            border-bottom: 1px solid #e0e0e0;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            pointer-events: auto;
        `;
        
        const arrowDown = document.createElement('div');
        arrowDown.className = 'submenu-arrow submenu-arrow-down';
        arrowDown.innerHTML = '<i class="fa fa-chevron-down"></i>';
        arrowDown.style.cssText = `
            display: none;
            position: fixed;
            left: 0;
            width: 100%;
            height: ${ARROW_HEIGHT}px;
            background: linear-gradient(to bottom, rgba(255,255,255,0.85), rgba(255,255,255,0.95));
            align-items: center;
            justify-content: center;
            z-index: 10001;
            cursor: pointer;
            border-top: 1px solid #e0e0e0;
            box-shadow: 0 -2px 4px rgba(0,0,0,0.1);
            pointer-events: auto;
        `;
        
        dropdown.appendChild(arrowUp);
        dropdown.appendChild(arrowDown);
        
        if (window.getComputedStyle(dropdown).position === 'static') {
            dropdown.style.position = 'relative';
        }
        
        const data = {
            arrowUp,
            arrowDown,
            scrollInterval: null,
            isScrolling: false
        };
        
        dropdownData.set(dropdown, data);
        
        return data;
    }
    
    function isDropdownVisible(dropdown) {
        return dropdown.offsetParent !== null;
    }
    
    function updateArrowPositions(dropdown) {
        if (!isDropdownVisible(dropdown)) {
            return;
        }
        
        const data = dropdownData.get(dropdown);
        if (!data) return;
        
        const { arrowUp, arrowDown } = data;
        const dropdownRect = dropdown.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const contentHeight = dropdown.scrollHeight;
        const containerHeight = dropdown.clientHeight;
        
        const needsScroll = contentHeight > containerHeight || 
                           dropdownRect.bottom > viewportHeight || 
                           dropdownRect.top < 0;
        
        if (!needsScroll) {
            arrowUp.style.display = 'none';
            arrowDown.style.display = 'none';
            return;
        }
        
        const canScrollUp = dropdown.scrollTop > 5 || dropdownRect.top < 5;
        if (canScrollUp) {
            arrowUp.style.display = 'flex';
            const topPosition = Math.max(0, dropdownRect.top);
            arrowUp.style.top = `${topPosition}px`;
            arrowUp.style.left = `${dropdownRect.left}px`;
            arrowUp.style.width = `${dropdownRect.width}px`;
        } else {
            arrowUp.style.display = 'none';
        }
        
        const isAtBottom = dropdown.scrollTop + containerHeight >= contentHeight - 5;
        const dropdownBottom = dropdownRect.bottom;
        const canScrollDown = !isAtBottom || dropdownBottom > viewportHeight;
        
        if (canScrollDown) {
            arrowDown.style.display = 'flex';
            const bottomPosition = Math.min(viewportHeight - ARROW_HEIGHT, dropdownBottom - ARROW_HEIGHT);
            arrowDown.style.top = `${bottomPosition}px`;
            arrowDown.style.left = `${dropdownRect.left}px`;
            arrowDown.style.width = `${dropdownRect.width}px`;
        } else {
            arrowDown.style.display = 'none';
        }
    }
    
    function performScroll(dropdown, deltaY) {
        const dropdownRect = dropdown.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const scrollStep = deltaY;
        
        const contentHeight = dropdown.scrollHeight;
        const containerHeight = dropdown.clientHeight;
        
        if (contentHeight > containerHeight) {
            const isAtTop = dropdown.scrollTop === 0;
            const isAtBottom = dropdown.scrollTop + containerHeight >= contentHeight - 1;
            
            if (isAtTop && deltaY < 0) {
                const currentTop = parseInt(dropdown.style.top) || 0;
                const adjustment = scrollStep / 2;
                dropdown.style.top = `${currentTop - adjustment}px`;
            } 
            else if (isAtBottom && deltaY > 0) {
                const currentTop = parseInt(dropdown.style.top) || 0;
                const adjustment = scrollStep / 2;
                dropdown.style.top = `${currentTop - adjustment}px`;
            } 
            else {
                dropdown.scrollTop += scrollStep;
            }
        } 
        else {
            const isAtBottom = dropdownRect.bottom >= viewportHeight - 8;
            const isAtTop = dropdownRect.top <= 8;
            
            if ((isAtBottom && deltaY > 0) || (isAtTop && deltaY < 0)) {
                const currentTop = parseInt(dropdown.style.top) || 0;
                const adjustment = scrollStep / 10;
                dropdown.style.top = `${currentTop - adjustment}px`;
            }
        }
        
        updateArrowPositions(dropdown);
    }
    
    function setupArrowHandlers(dropdown) {
        const data = dropdownData.get(dropdown);
        if (!data) return;
        
        const { arrowUp, arrowDown } = data;
        
        function startScroll(direction) {
            if (data.isScrolling) return;
            
            data.isScrolling = true;
            const deltaY = direction * SCROLL_STEP;
            
            performScroll(dropdown, deltaY);
            
            data.scrollInterval = setInterval(() => {
                performScroll(dropdown, deltaY);
            }, SCROLL_INTERVAL);
        }
        
        function stopScroll() {
            data.isScrolling = false;
            if (data.scrollInterval) {
                clearInterval(data.scrollInterval);
                data.scrollInterval = null;
            }
        }
        
        arrowUp.addEventListener('mouseenter', (e) => {
            e.stopPropagation();
            startScroll(-1);
        });
        
        arrowUp.addEventListener('mouseleave', (e) => {
            e.stopPropagation();
            stopScroll();
        });
        
        arrowUp.addEventListener('mousemove', (e) => {
            e.stopPropagation();
        });
        
        arrowUp.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
        
        arrowDown.addEventListener('mouseenter', (e) => {
            e.stopPropagation();
            startScroll(1);
        });
        
        arrowDown.addEventListener('mouseleave', (e) => {
            e.stopPropagation();
            stopScroll();
        });
        
        arrowDown.addEventListener('mousemove', (e) => {
            e.stopPropagation();
        });
        
        arrowDown.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
    }
    
    const dropdowns = menu.querySelectorAll('ul ul');
    dropdowns.forEach(dropdown => {
        createArrows(dropdown);
        setupArrowHandlers(dropdown);
        
        const observer = new MutationObserver(() => {
            if (isDropdownVisible(dropdown)) {
                // Используем requestAnimationFrame для более точного времени
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        updateArrowPositions(dropdown);
                    });
                });
            } else {
                const data = dropdownData.get(dropdown);
                if (data) {
                    data.arrowUp.style.display = 'none';
                    data.arrowDown.style.display = 'none';
                    if (data.scrollInterval) {
                        clearInterval(data.scrollInterval);
                        data.scrollInterval = null;
                        data.isScrolling = false;
                    }
                }
            }
        });
        
        observer.observe(dropdown, {
            attributes: true,
            attributeFilter: ['style', 'class']  // Добавлен 'class' на случай изменения классов
        });
        
        dropdown.addEventListener('scroll', () => updateArrowPositions(dropdown));
    });
    
    // Добавляем обработчик для hover событий на родительских элементах
    menu.querySelectorAll('li').forEach(item => {
        item.addEventListener('mouseenter', function() {
            const dropdown = this.querySelector('ul');
            if (dropdown) {
                updateArrowPositions(dropdown);
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        if (isDropdownVisible(dropdown)) {
                            updateArrowPositions(dropdown);
                        }
                    });
                });
            }
        });
    });
    
    menu.addEventListener('wheel', function(e) {
        const dropdown = e.target.closest('ul ul');
        
        if (dropdown && dropdown.offsetParent !== null) {
            const data = dropdownData.get(dropdown);
            if (data && data.isScrolling) {
                return;
            }
            
            e.preventDefault();
            performScroll(dropdown, e.deltaY);
        }
    }, { passive: false });
    
    window.addEventListener('resize', () => {
        dropdowns.forEach(dropdown => {
            if (isDropdownVisible(dropdown)) {
                updateArrowPositions(dropdown);
            }
        });
    });
});
}