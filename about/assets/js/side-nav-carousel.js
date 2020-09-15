/* Carousel code for a carousel with side navigation tabs
Created by: Alexandra French
For: the Robotics Club of Central Florida
On: August 10, 2020

Last modified on: August 29, 2020
By: Alexandra French
*/

// whether or not a slide has been clicked
var slideClicked;

// setup the current active slide
function setClickedSlide() {
	// set as clicked
	slideClicked = true;
	// move current active element
	$('.list-group li').removeClass('active');
	$(this).addClass('active');
}

// setup all the active/not active child slides
function setArrowSlides(e) {
	// if nothing clicked yet, setup the active and nonactive elemnts
	if (!slideClicked) {
		// remove active from current slide and add it to the next one
		($('.list-group li.active')).removeClass('active').next().addClass('active');
		// see if at max slide, if so set first slide as active
		if(($('.list-group').children().length - 1) == (parseInt(($('.list-group li.active')).data('slide-to')))) {
			$('.list-group li').first().addClass('active');
		}
	}
	slideClicked = false;
}

// run all functions related to the lost carousel
function lostCarousel(){
	// set as not clicked yet
	slideClicked = false;

	// Adjust active slide for all events
	$('#side-nav-carousel').on('click', '.list-group li', setClickedSlide);
	$('#side-nav-carousel').on('slide.bs.carousel', setArrowSlides);
}

// run for the current page
$(document).ready(lostCarousel)
