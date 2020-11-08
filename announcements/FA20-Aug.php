<?php

// all variables
$pageCreator = "Alexandra French";
$pageCreationDate = "August 5, 2020";
$title = "Robotics Club August Announcements";
$currentWebmaster = "Alexandra French";
$updateDate = "November 4, 2020";
$pageDescription = "Robotics Club of Central Florida has regular site updates, workshops, socials, and project meetups.";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club, announcements, events, august, august events,
                               new website, fall 2020 introductory meeting, photo galleries";
$url = "https://robotics.ucf.edu/announcements/FA20-Aug";
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
            <p> Here you can find all of our August 2020 events and news!
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

$description = "Curious about how our club meetings look?
              Want to see what kind of virtual socials we have? Or maybe just want to see the progress
              of one of our various projects? View them now in our photo gallery!";
$announcement->generate("Darkmode and Constitution", "assets/imgs/galleries.jpg", "citrobot photo gallery", $description, "August 27, 2020", "Alexandra French (Webmaster)", "View Photo Gallery &rarr;", "../more/gallery");

$description = "You can now view our officer and member histories. Histories of our members
              all the way to 2016 and histories of our officers all the way to 2015 are available. From now
              on, all new members will be added to our histories.";
$announcement->generate("Club Member History", "assets/imgs/member-history.jpg", "club member history", $description, "August 26, 2020", "Alexandra French (Webmaster)", "View Past Members &rarr;", "../about/past-members");

$description = "As we get closer to fall, we get closer to our introductory meetings!
              Now planned for Aug 31st and Sept 8th at 6:30PM.
              Join our <a href=\"https://discord.gg/ypWpanw\">Discord</a> to meet us!
              We'll discuss the club, our three robotics projects, and our expected virtual software, CAD, and general workshops.";
$announcement->generate("Introductory Meetings", "assets/imgs/FA20-intro.jpg", "introductory meeting ad", $description, "August 23, 2020", "Alexandra French (Webmaster)", null, null);

$description = "The website now includes dark mode! Automatically added for any browser
              with the default. Otherwise, enable it under \"More\".<br>
              With dark mode comes a new page: our constitution. Check out any and all club guidelines there.";
$announcement->generate("Darkmode and Constitution", "assets/imgs/darkmode.jpg", "darkmode", $description, "August 10, 2020", "Alexandra French (Webmaster)", "View the Constitution &rarr;", "../about/constitution");

$description = "Fall is quickly approaching! With it, we're
              working out virtual meetups, new semester workshops, club meeting
              days, and more! Join our <a href=\"https://discord.gg/ypWpanw\">Discord</a>
              to get involved, check out our current projects:
              <a href=\"../projects/bowser/index\">Bowser</a>,
              <a href=\"../projects/citrobot/index\">Citrobot</a>, and
              <a href=\"../projects/demobot/index\">Demobot</a>,
              and check back for more updates!";
$announcement->generate("New Semester", "assets/imgs/citrobot.jpg", "citrobot", $description, "August 6, 2020", "Alexandra French (Webmaster)", null, null);

$description = "The new Robotics Club of Central Florida website is up! New features such as news have been added, tracking of projects has been made easier, and most old pages have been updated. Old projects and newsletter is still under construction!";
$announcement->generate("New Website", "assets/imgs/new-website.jpg", "new website", $description, "August 5, 2020", "Alexandra French (Webmaster)", "Learn About the Website &rarr;", "post-1");

// adds bottom of page pagination
require_once("../assets/templates/pagination-bottom.php");
$pagination = new Pagination("FA20-Aug", "FA20-Sep", null);
$pagination->generate(array("index", "FA20-Oct", "FA20-Sep", "FA20-Aug"), FALSE);

?>

  </div>
  <!-- /.container -->
  
<?php

// footer functions and include
include_once("../assets/templates/footer.php");

?>
