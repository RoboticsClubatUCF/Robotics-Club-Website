/* Global Scripts for the webpage
Created by: Alexandra French
For: the Robotics Club of Central Florida
On: August 11, 2020

Last modified on: September 11, 2020
By: Alexandra French
*/

// DARK MODE
// Check for dark mode preference at the OS and local storage levels
const prefersDarkScheme = window.matchMedia("(prefers-color-scheme: dark)");
const currentTheme = localStorage.getItem("theme");

// If the user's preference is darkmode, toggle darkmode
// otherwise remove darkmode
if (currentTheme == "dark" || currentTheme == null && prefersDarkScheme.matches) {
  document.body.classList.toggle("dark");
  document.getElementById('switch-toggle').classList.toggle("on");
} else {
  document.body.classList.remove("dark");
  document.getElementById('switch-toggle').classList.remove("on");
}


// when the darkmode button is clicked
const themeToggle = document.getElementById('toggle-dark');
themeToggle.addEventListener("click", function() {
  // if os setting is dark mode, set it as light mode, otherwise set as darkmode
  if (prefersDarkScheme.matches) {
    // if contains darkmode already, set it as light mode
    // otherwise set it to darkmode
    var theme = document.body.classList.contains("dark") ? "light" : "dark";

    // if dark, toggle dark. otherwise, vice versa
    if (theme == "dark") {
      document.body.classList.toggle("dark");
      document.getElementById('switch-toggle').classList.toggle("on");
    } else {
      document.body.classList.remove("dark");
      document.getElementById('switch-toggle').classList.remove("on");
    }
  } else {
    // get the current theme
    var theme = document.body.classList.contains("dark") ? "dark" : "light";

    // if lightmode, toggle darkmode. otherwise, vice versa
    if (theme == "light") {
      document.body.classList.toggle("dark");
      document.getElementById('switch-toggle').classList.toggle("on");
      theme = "dark";
    } else {
      document.body.classList.remove("dark");
      document.getElementById('switch-toggle').classList.remove("on");
      theme = "light";
    }
  }

  // save the theme to local storage
  localStorage.setItem("theme", theme);
});


// SLIDE IN SCROLLING
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
