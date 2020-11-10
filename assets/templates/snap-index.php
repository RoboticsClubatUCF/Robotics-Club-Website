<?php
  include_once('assets/templates/slideshows.php');
  $slideshowGen = new Slideshows();
  
  include_once('assets/templates/footer.php');
  $footerGen = new Footer();
?>


<!DOCTYPE html>
<!--  Website created by Alexandra French
      For the Robotics Club of Central Florida
      Created on August 5, 2020
      Contact club: ucfroboticsclubnews@gmail.com
                    robotics@ucf.edu

      Last Updated on: November 9, 2020
      Last Updated By: Alexandra French
-->

<html lang="en">

<head>

  <!-- bare minimum -->
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">

  <!-- icons -->
  <link rel="icon" href="/assets/imgs/favicon.ico">
  <link rel="roboskull icon" href="/assets/imgs/favicon.ico">
  <link rel="mask-icon" href="/assets/imgs/favicon.ico" color="white">
  <link rel=”apple-touch-icon” sizes="114×114" href="/assets/imgs/favicon.ico" />
  <link rel=”apple-touch-icon” sizes="72×72" href="/assets/imgs/favicon.ico" />
  <link rel=”apple-touch-icon” href="/assets/imgs/favicon.ico" />

  <!-- Website Info -->
  <title>Robotics Club of Central Florida</title>
  <meta name="author" content="Alexandra French">
  <meta name="description" content="The Robotics Club of Central Florida is a student powered club based on hands on work with autonomous robotics.">
  <meta name="keywords" content="UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                                 UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                                 melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                                 mechanical engineering, electrical, eletrical engineering, computer, computers,
                                 computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                                 machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                                 Central Florida, central florida, robotics club">
  <link rel="canonical" href="https://robotics.ucf.edu"/>

  <!-- facebook open graphs -->
  <meta property="og:url"                content="https://robotics.ucf.edu" />
  <meta property="og:type"               content="website" />
  <meta property="og:title"              content="Robotics Club of Central Florida" />
  <meta property="og:description"        content="A student run club dedicated to exploring and improving robotics. Current projects: a combat bot, an autonomous bot, and a demonstration bot." />
  <meta property="og:image"              content="https://robotics.ucf.edu/assets/imgs/header/roboskull-gold.png" />

  <!-- twitter card -->
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:site" content="@RoboticsClubCFl" />
  <meta name="twitter:title" content="Robotics Club of Central Florida" />
  <meta name="twitter:description" content="A student run club dedicated to exploring and improving robotics. Current projects: a combat bot, an autonomous bot, and a demonstration bot." />
  <meta name="twitter:image" content="https://robotics.ucf.edu/assets/imgs/header/roboskull-gold.png" />

  <!-- verification of ownership for google search -->
  <meta name="google-site-verification" content="NDgsiRwy1o33-MY4WCiz7Fi69rFDe5iEHkB2cfptC8I" />

  <!-- Global site tag (gtag.js) - Google Analytics -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=UA-18245445-1"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());

    gtag('config', 'UA-18245445-1');
  </script>

  <!-- schema markup  -->
  <script type="application/ld+json">
  {
    "@context" : "https://schema.org",
    "@type" : "Organization",
    "image" : "https://robotics.ucf.edu/assets/imgs/header/roboskull-gold.png",
    "name" : "Robotics Club of Central Florida",
    "telephone" : "(407) 882-0293",
    "email" : "robotics@ucf.edu",
    "address" : {
      "@type" : "PostalAddress",
      "streetAddress" : "Partnership II Rm 108, 3100 Technology Pkwy",
      "addressLocality" : "Orlando",
      "addressRegion" : "Florida",
      "addressCountry" : "USA",
      "postalCode" : "32826"
    },
    "url" : "https://robotics.ucf.edu/",
    "sameAs" : [
      "https://facebook.com/RoboticsClub",
      "https://instagram.com/RoboticsClubCFl",
      "https://twitter.com/RoboticsClubCFl",
      "https://www.youtube.com/channel/UCZEPdNUFzkciC7MIiI-yPKg",
      "https://linkedin.com/company/robotics-club-at-ucf"
    ]
  }
  </script>

  <!-- geotags -->
  <meta name="ICBM" content="28.585626, -81.199236">
  <meta name="geo.position" content="28.585626;-81.199236">
  <meta name="geo.region" content="US-FL">
  <meta name="geo.placename" content="Orlando">

  <!-- Bootstrap -->
  <link href="assets/rsrc/bootstrap/css/bootstrap.min.css" rel="stylesheet">

  <!-- Page styles -->
  <link href="assets/css/global-styles.css" rel="stylesheet">
  <link href="assets/css/index.css" rel="stylesheet">

</head>

<body>  
  <div class="page-container">
  <!-- Navbar -->
  <div class="fixed-top">
    <nav class="navbar navbar-expand-lg navbar-dark bg-clear text-right" id="navigation bar">
      <div class="container">
        <!-- logo and name -->
          <a class="navbar-brand" href="/">
            <div class="nav-img">
              <img src="/assets/imgs/header/roboskull-white.png" alt="club logo white">
              <img class="overlay" src="/assets/imgs/header/roboskull-gold.png" loading="lazy" alt="club logo gold">
              <div class="d-none d-md-block" id="nav-logo-text" aria-label="navigation-logo-text">Robotics Club of Central Florida</div>
              <div class="d-none d-block d-md-none">&nbsp;</div>
            </div>
          </a>
          <!-- navigation links -->
        <button class="navbar-toggler navbar-toggler-right" type="button" data-toggle="collapse" data-target="#navbarResponsive" aria-controls="navbarResponsive" aria-expanded="false" aria-label="Toggle navigation">
          <span class="navbar-toggler-icon"></span>
        </button>
        <div class="collapse navbar-collapse" id="navbarResponsive">
          <ul class="navbar-nav ml-auto">
            <li class="nav-item dropdown">
              <a class="nav-link dropdown-toggle" href="#" id="navbarDropdownPages" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
                About
              </a>
              <div class="dropdown-menu dropdown-menu-right" aria-labelledby="navbarDropdownPages">
                <a class="dropdown-item" href="/about/index">About Us</a>
                <a class="dropdown-item" href="/about/contact">Contact Us</a>
                <a class="dropdown-item" href="/about/constitution">Constitution</a>
              </div>
            </li>
            <li class="nav-item">
              <a class="nav-link" href="/projects/index">Projects</a>
            </li>
            <li class="nav-item">
              <a class="nav-link" href="/announcements/index">Announcements</a>
            </li>
            <li class="nav-item dropdown">
              <a class="nav-link dropdown-toggle" href="#" id="navbarDropdownPages" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
                News
              </a>
              <div class="dropdown-menu dropdown-menu-right" aria-labelledby="navbarDropdownPages">
                <a class="dropdown-item" href="/news/index">Newsletter</a>
                <a class="dropdown-item" href="/news/social-media">Social Media Feed</a>
                <a class="dropdown-item" href="https://us11.campaign-archive.com/home/?u=ba5c2944886feb2964a80fe11&id=e63d752fa6">News Archive</a>
              </div>
            </li>
            <li class="nav-item">
              <a class="nav-link" href="/sponsors/index">Sponsors</a>
            </li>
            <li class="nav-item">
              <a class="nav-link" href="/faq/index">FAQ</a>
            </li>
            <li class="nav-item dropdown">
              <a class="nav-link dropdown-toggle" href="#" id="navbarDropdownPages" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
                More
              </a>
              <div class="dropdown-menu dropdown-menu-right" aria-labelledby="navbarDropdownPages">
                <a class="dropdown-item" href="/more/gallery">Photo Gallery</a>
                <div id="theme-toggle">
                  <label for="toggle-dark">Dark Mode
                  <div class="switch">
                    <input type="checkbox" id="toggle-dark">
                    <div class="slider round" id="switch-toggle"></div>
                  </div>
                  </label>
                </div>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </nav>
  </div>
  <!-- /.navbar -->


  <!-- snap container for page -->
  <div class="snapper y mandatory-snapping">
    <!-- snap slideshow and news -->
    <div class="snap-child justify-content-center align-items-center">
      <?php
        $images = array("assets/imgs/home/roboticsSlide.jpg", "assets/imgs/home/innovationSlide.jpg", "assets/imgs/home/successSlide.jpg");
        $slideshowGen->generateWideSlideshow(3, $images, array("Robotics", "Innovation", "Success"));
      ?>

      <!-- Page Content Container 1 -->
      <div class="container">
        <!-- calendar and announcements -->
        <div class="ann-cal-container">
          <!-- calendar/announcements -->
          <div class="row h-100 pt-2 pb-2 no-gutters">
            <!-- button to show calendar -->
            <div class="button-container">
              <button type="button" class="btn btn-secondary calendar-button d-flex align-items-center justify-content-center" id="calendar-button">
                <div class="calendar-text">Calendar</div>
              </button>
            </div>
            <!-- button to show announcements -->
            <div class="button-container">
              <button type="button" class="btn btn-secondary calendar-button d-flex align-items-center justify-content-center disabled" id="announcement-button">
                <div class="calendar-text">News</div>
              </button>
            </div>
            <!-- /.announcements button -->
            <!-- container for announcements and calendar-->
            <div class="events">
              <!-- calendar, shows initially -->
              <div class="calendar-container hidden" id="calendar">
                <div class="fix-calendar">
                  <iframe loading="lazy" src="https://calendar.google.com/calendar/embed?height=300&amp;wkst=1&amp;bgcolor=%23212121&amp;ctz=America%2FNew_York&amp;src=bThzbzIwNXJqMjUyNm40cm92YnAzdDRmMDRAZ3JvdXAuY2FsZW5kYXIuZ29vZ2xlLmNvbQ&amp;src=ZW4udXNhI2hvbGlkYXlAZ3JvdXAudi5jYWxlbmRhci5nb29nbGUuY29t&amp;color=%239D7000&amp;color=%23227F63&amp;showTitle=0&amp;showNav=0&amp;showDate=0&amp;showPrint=0&amp;showCalendars=0&amp;showTz=0&amp;mode=MONTH" style="border:solid 1px #777" width="350" height="500" frameborder="0" scrolling="no"></iframe>
                </div>
              </div>
              <!-- /.calendar -->
              <!-- announcements, hidden initially -->
              <div class="announcements-container align-items-center justify-content-center" id="announcements">
                  <div class="row align-items-center justify-content-center text-center" style="margin: auto">
                      <div class="announcements-title title-gold p-2"><h2 class="font-weight-bold">News</h2></div>
                  </div>
                  <div class="d-flex row align-self-center justify-self-center p-2" style="margin: auto">
                    <div class="d-none d-md-block tax-center w-100">
                      <p class="text-center w-100">Officer nominations are coming up!
                      </p>
                    </div>
                    <p class="text-center w-100">
                      Our ROS/Gazebo workshop will be rescheduled for later this semester.
                      Our officer nominations will be Monday, Nov 9th, at 6:30pm!
                      Join our <a href="https://discord.gg/ypWpanw">Discord</a> to join us for nominations.
                    </p>
                    <div class="d-none d-md-block tax-center w-100">
                      <p class="text-center w-100">
                        For nominations, any dues paying member can nominate themselves to a position!
                        This is a great chance to get involved further in robotics and clubs.
                      </p>
                    </div>
                  </div>
              </div>
            <!-- /.announcements -->
            </div>
            <!--- /.container for announcements and events -->
          </div>
          <!-- /.calendar/announcements -->
        </div>
        <!-- /.calendar and announcements -->
      </div>
      <!-- /.container 1 -->
    </div>
    <!-- snap slideshow and news -->


    <!-- who are we snap container -->
    <div class="snap-child justify-content-center align-items-center">
    <!-- Page Content Container 2 -->
      <div class="container justify-content-center align-items-center">
        <!-- flex containers -->
        <div class="intermediate-container-flex justify-content-center align-items-center">
          <div class="d-flex flex-column justify-content-center align-items-center">
            <!-- intro -->
            <div class="intro justify-content-center align-items-center">
              <!-- title row -->
              <div class="row w-100 no-gutters">
                <div class="col-lg-12">
                  <h2 class="text-center p-2 rounded title-blk-wht w-100 font-weight-bold">Who Are We?</h2>
                </div>
              </div>
              <!-- /.title row -->
              <!-- content row -->
              <div class="row w-100 h-100 no-gutters">
                <div class="col-lg-12">
                  <div class="text-center p-4 container-wht-blk rounded w-100">
                    <div class="d-none d-md-block"><p>Welcome to the Robotics Club of Central Florida.
                      <br> This is an entirely student run organization.
                    </p></div>
                    <div class="d-none d-sm-block">
                      <p>We focus on creating innovative and competitive robots and we are always
                        looking for members join in the advancement of the demanding robotics field.
                      </p>
                   </div>
                    <p>
                        Every year we take on projects that involve
                        demonstrations of robotics, pushing the bounds of automation, and innovative, robust designs.
                    </p>
                    <p>
                      Currently, we are realizing three challenging projects...
                    </p>
                  </div>
                </div>
              </div>
              <!-- /.content row -->
            </div>
            <!-- /.intro -->
          </div>
        </div>
        <!-- flex container -->
      </div>
      <!-- /.page container -->
    </div>
    <!-- /.who we are snap container -->

    <!-- robot slides snap container-->
    <div class="snap-child">
      <!-- Page Content Container 2 -->
      <div class="container">
        <!-- flex containers -->
        <div class="intermediate-container-flex">
          <h2 class="sr-only">Our Robots</h2>
          <?php
            $images = array("assets/imgs/placeholder-600x600.png", "assets/imgs/home/bowser.jpg", "assets/imgs/home/citrobot.jpg");
            $titles = array("Demobot", "Bowser", "Citrobot");
            $captions = array("Demonstrates all aspects of robotics.", "Uses computer vision to avoid objects.", "Our 15lb combat monster.");
            $slideshowGen->generateCircleSlideshow($images, $titles, $captions);
          ?>
        </div>
        <!-- /.flex containers -->
      </div>
      <!-- /.page content container -->
    </div>
    <!-- /.robot slides snapper -->


    <!-- grid snapper -->
    <div class="snap-child justify-content-center align-items-center" id="grid-snapper">
      <!-- flex containers -->
      <div class="end-container-flex justify-self-center align-self-center grid" id="grid-end-1">
        <?php
          include_once("assets/templates/grid.html");
        ?>
      </div>
      <!-- /.page container -->
    </div>
    <!-- /.grid -->


  </div>
  <!-- /.page snap container -->
</div>
<!-- page container -->
