<?php

// all variables
$pageCreator = "Alexandra French";
$pageCreationDate = "October 5, 2020";
$title = "Robotics Club September Announcements";
$currentWebmaster = "Alexandra French";
$updateDate = "November 4, 2020";
$pageDescription = "In September, we had resume, CAD, and python workshops.";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club, announcements, events, september, september events,
                               september intro to python, september CAD workshop, september resume workshop";
$url = "https://robotics.ucf.edu/announcements/FA20-Sep";
$markupImage = "https://robotics.ucf.edu/announcements/assets/imgs/FA20-intro.jpg";

// header functions and include
include_once("../assets/templates/header.php");


// navbar
include_once("../assets/templates/navbar.php");

?>

  <!-- Page Content -->
  <div class="container">

    <!-- announcements and events -->
    <div class="header-container-sm">
      <!-- title -->
      <h1 class="mt-4 mb-3 text-center p-2 title-blk-gold">Announcements and Events
      </h1>
      <!-- inner text -->
      <div class="container-wht-blk rounded p-3">
        <h2 class="text-center">Watching Our Progress? Getting Involved?</h2>
        <div class="row text-center">
          <div class="col-lg-12">
            <p> Here you can find all of our September 2020 events and news! We focused on workshops in September.
            </p>
          </div>
        </div>
      </div>
    </div>
    <!-- /.announcements -->
    
<?php

// all the announcements for this page
include_once('assets/templates/announcement.php');
$announcement = new Announcement();

$description = "We have an upcoming CAD workshop this week, September 30, at 6:30pm.
              Join us to learn more about assemblies and drawing.
              We also have an upcoming resume workshop this week, October 2nd, at 6:30pm.
              Join us to learn how to make a good resume, avoid some common mistakes, and see where to apply to internships!";
$announcement->generate("Resume and CAD Workshops", "assets/imgs/resume-workshop-robot.jpg", "resume workshop", $description, "September 28, 2020", "Alexandra French (Webmaster)", null, null);

$description = "We have an upcoming introduction to python workshop this week, September 25, at 6:30pm.
              Join us to learn more about how to use python and make a small game while you're at it!.";
$announcement->generate("Intro to Python Workshop", "assets/imgs/python-workshop-hangman.jpg", "python workshop", $description, "September 22, 2020", "Alexandra French (Webmaster)", null, null);

$description = "We have an upcoming CAD workshop this week, September 16, at 6:30pm. Join us to learn more about how to get and use Fusion 360, the tools that are offered by it, how to create basic sketches, and other information on using CAD!";
$announcement->generate("CAD Workshop", "assets/imgs/2020-cad-workshop-1.jpg", "CAD drawing", $description, "September 15, 2020", "Alexandra French (Webmaster)", null, null);

// adds bottom of page pagination
require_once("../assets/templates/pagination-bottom.php");
$pagination = new Pagination("FA20-Sep", "FA20-Oct", "FA20-Aug");
$pagination->generate(array("index", "FA20-Oct", "FA20-Sep", "FA20-Aug"), FALSE);

?>

  </div>
  <!-- /.container -->
  
<?php

// footer functions and include
include_once("../assets/templates/footer.php");

?>
