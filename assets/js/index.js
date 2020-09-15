/* script grids, responsive circle slides, and calendar swaps
Created by: Alexandra French
For: the Robotics Club of Central Florida
On: August 23, 2020

Last modified on: August 23, 2020
By: Alexandra French
*/

// ------------------------------------- CALENDAR -------------------------------------
// Grab the calendar and announcement buttons
var calendarButton = document.getElementById("calendar-button");
var announcementsButton = document.getElementById("announcement-button");
var announcements = document.getElementById('announcements');

// get the calendar and announcements portions
var calendar = document.getElementById('calendar');

// if the calendar button is active and clicked, disable it and activate announcements
calendarButton.onclick = function() {
  if (!calendarButton.classList.contains("disabled")) {
    announcementsButton.classList.remove("disabled");
    calendarButton.classList.add("disabled");

    calendar.classList.remove("hidden");
    announcements.classList.add("hidden");
  }
};

// if the announcements button is active and clicked, disable it and activate calendar
announcementsButton.onclick = function() {
  if (!announcementsButton.classList.contains("disabled")) {
    calendarButton.classList.remove("disabled");
    announcementsButton.classList.add("disabled");

    announcements.classList.remove("hidden");
    calendar.classList.add("hidden");
  }
};


// ------------------------------------- ROBOT SLIDES -------------------------------------
// function to clone 3 of each slide
function cloneSlides(){
  // get the current and the  next item, dependant on length
  var curr = $(this);
  var next = curr.next();
  if (!next.length) {
    next = curr.siblings(':first');
  }

  // clone next child
  next.children(':first-child').clone().appendTo(curr);

  // if there is a next.next, clone it, otherwise search children and close the first one
  if (next.next().length > 0) {
    next.next().children(':first-child').clone().appendTo(curr);
  } else {
    curr.siblings(':first').children(':first-child').clone().appendTo(curr);
  }
}

// jquery to make the slides move forward one by one through cloning
(function($) {
    // grab the robot slide items
    var s = $('#robotCarousel.carousel .carousel-item')

    // for each slide, run the cloning and adjust slides
    s.each(cloneSlides);
})(jQuery);


// when the next button is clicked, run through the slides
const next = document.getElementById('robot-next');
next.addEventListener("click", embiggenForwards);

// when the prev button is clicked, run through the slides
const prev = document.getElementById('robot-prev');
prev.addEventListener("click", embiggenBackwards);

// makes cards bigger on forwards click
function embiggenForwards() {
  // get all the cards
  var slides = document.getElementsByClassName("robo-item");

  // make the middle card big in all cases
  if (slides[0].classList.contains("active")) {
    for (i = 0; i < 3; i++) {
      slides[i].classList.remove("small-0");
      slides[i].classList.remove("small-1");
      slides[i].classList.toggle("small-2");
    }

  } else if (slides[1].classList.contains("active")) {
    for (i = 0; i < 3; i++) {
      slides[i].classList.toggle("small-0");
      slides[i].classList.remove("small-1");
      slides[i].classList.remove("small-2");
    }

  } else {
    for (i = 0; i < 3; i++) {
      slides[i].classList.remove("small-0");
      slides[i].classList.toggle("small-1");
      slides[i].classList.remove("small-2");
    }
  }
};

// makes cards bigger on backwards click
function embiggenBackwards() {
  // get all the cards
  var slides = document.getElementsByClassName("robo-item");

  // make the middle card big in all cases
  if (slides[0].classList.contains("active")) {
    for (i = 0; i < 3; i++) {
      slides[i].classList.toggle("small-0");
      slides[i].classList.remove("small-1");
      slides[i].classList.remove("small-2");
    }

  } else if (slides[1].classList.contains("active")) {
    for (i = 0; i < 3; i++) {
      slides[i].classList.remove("small-0");
      slides[i].classList.toggle("small-1");
      slides[i].classList.remove("small-2");
    }

  } else {
    for (i = 0; i < 3; i++) {
      slides[i].classList.remove("small-0");
      slides[i].classList.remove("small-1");
      slides[i].classList.toggle("small-2");
    }
  }
};



// ------------------------------------- GRID -------------------------------------
// if clicked in a particular grid section of join, follow, contact, and Visit
// then show all links. otherwise, dont show anything to avoid accidental clicks
// if clicked in follow, show links, otherwise hide them
var seconds;

function adjustLinks() {
  // avoid accidental clicks for join
  if (document.getElementById('join-overlay').contains(event.target)) {
    // shows link and buttons on a delay timer to avoid clicking them
    setTimeout(function(){
      var links = document.getElementsByClassName("grid1-link");
      for (var i = 0; i < links.length; i++) {
        links[i].style.pointerEvents = "auto";
      }
      $("#alert-btn").prop('disabled', false);
    }, seconds);
  } else {
    // hides links and buttons immediately to avoid clicking them
    var links = document.getElementsByClassName("grid1-link");
    for (var i = 0; i < links.length; i++) {
      links[i].style.pointerEvents = "none";
    }
    // hide buttons to avoid clicking them
    $("#alert-btn").prop('disabled', true);
  }

  // avoid accidental clicks for follow
  if (document.getElementById('follow-overlay').contains(event.target)) {
    // shows link on a delay timer to avoid clicking them
    setTimeout(function(){
      var links = document.getElementsByClassName("grid2-link");
      for (var i = 0; i < links.length; i++) {
        links[i].style.pointerEvents = "auto";
      }
    }, seconds);
  } else {
    // hides links immediately to avoid clicking them
    var links = document.getElementsByClassName("grid2-link");
    for (var i = 0; i < links.length; i++) {
      links[i].style.pointerEvents = "none";
    }
  }

  // avoid accidental clicks for contact
  if (document.getElementById('contact-overlay').contains(event.target)) {
    // shows link on a delay timer to avoid clicking them
    setTimeout(function(){
      var links = document.getElementsByClassName("grid3-link");
      for (var i = 0; i < links.length; i++) {
        links[i].style.pointerEvents = "auto";
      }
    }, seconds);
  } else {
    // hides links immediately to avoid clicking them
    var links = document.getElementsByClassName("grid3-link");
    for (var i = 0; i < links.length; i++) {
      links[i].style.pointerEvents = "none";
    }
  }
};

// track clicks for mobile
document.addEventListener('click', function() {
  // calls a function that disables links for inactive grid cards
  seconds = 2500;
  adjustLinks();
});

// track mouseover for computer
document.addEventListener('mouseover', function() {
  // calls a function that disables links for inactive grid cards
  seconds=500;
  adjustLinks();
});
