/* Scroll sliding code for the webpage
Created by: Alexandra French
For: the Robotics Club of Central Florida
On: August 27, 2020

Last modified on: August 27, 2020
By: Alexandra French
*/

// find if the element is partially in view or not
function isPartiallyInView(el) {
  // calculate the window heigt/width
  var windowWidth = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
  var windowHeight = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);

  // see if element in view
  return ((el.getBoundingClientRect().top + el.clientHeight > 0 && el.getBoundingClientRect().top < windowHeight)
      && (el.getBoundingClientRect().left + el.clientWidth > 0 && el.getBoundingClientRect().left < windowWidth));
}

// set a visible slide to not animate
function setVisibleSlides(i, el) {
 if (isPartiallyInView(el)) {
   $(el).addClass("no-slide");
 }
}

// set an invisible slide to animate
function setInvisibleSlides(i, el) {
 if (isPartiallyInView(el)) {
   $(el).addClass("slide-in");
 }
}

// for each child, set as slide if visible
function animateSlideIn(event) {
   $(".slide-child").each(setInvisibleSlides);
}

// for each child, set as dont slide if already visible
$(".slide-child").each(setVisibleSlides);

// on scroll event, perform slide in on any newly visible elements
$(window).scroll(animateSlideIn);
